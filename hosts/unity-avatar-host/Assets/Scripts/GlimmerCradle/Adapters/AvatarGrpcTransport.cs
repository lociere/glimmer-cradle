using System;
using System.Threading;
using System.Threading.Tasks;
using Google.Protobuf;
using Grpc.Core;
using Contract = GlimmerCradle.Contracts.Glimmer.Avatar.V1;

namespace GlimmerCradle.UnityAvatarHost.Adapters
{
    public sealed class AvatarGrpcTransport : IDisposable
    {
        private static readonly Method<Contract.AvatarUpstreamFrame, Contract.AvatarDownstreamFrame> ConnectMethod =
            new Method<Contract.AvatarUpstreamFrame, Contract.AvatarDownstreamFrame>(
                MethodType.DuplexStreaming,
                "glimmer.avatar.v1.AvatarHostService",
                "Connect",
                Marshallers.Create(value => value.ToByteArray(), Contract.AvatarUpstreamFrame.Parser.ParseFrom),
                Marshallers.Create(value => value.ToByteArray(), Contract.AvatarDownstreamFrame.Parser.ParseFrom));

        private Channel channel;
        private AsyncDuplexStreamingCall<Contract.AvatarUpstreamFrame, Contract.AvatarDownstreamFrame> stream;

        public bool IsConnected => stream != null && channel != null && channel.State == ChannelState.Ready;

        public async Task ConnectAsync(string endpoint, string authToken, CancellationToken token)
        {
            var target = ParseGrpcTarget(endpoint);
            channel = new Channel(target, ChannelCredentials.Insecure);
            await channel.ConnectAsync(DateTime.UtcNow.AddSeconds(10));
            token.ThrowIfCancellationRequested();
            var headers = new Metadata { { "x-glimmer-avatar-token", authToken ?? string.Empty } };
            stream = new DefaultCallInvoker(channel).AsyncDuplexStreamingCall(
                ConnectMethod,
                null,
                new CallOptions(headers, cancellationToken: token));
        }

        public async Task ReceiveAsync(Action<Contract.AvatarDownstreamFrame> receive, CancellationToken token)
        {
            if (receive == null) throw new ArgumentNullException(nameof(receive));
            while (!token.IsCancellationRequested && await stream.ResponseStream.MoveNext(token))
            {
                receive(stream.ResponseStream.Current);
            }
        }

        public Task WriteAsync(Contract.AvatarUpstreamFrame message, CancellationToken token)
        {
            token.ThrowIfCancellationRequested();
            if (stream == null) throw new InvalidOperationException("Avatar gRPC stream 尚未连接");
            return stream.RequestStream.WriteAsync(message);
        }

        public async Task ShutdownAsync()
        {
            try
            {
                if (stream != null) await stream.RequestStream.CompleteAsync();
            }
            catch (RpcException)
            {
                // 对端已停止时只需继续释放本地 channel。
            }
            stream?.Dispose();
            stream = null;
            if (channel != null)
            {
                await channel.ShutdownAsync();
                channel = null;
            }
        }

        public void Dispose()
        {
            stream?.Dispose();
            stream = null;
        }

        private static string ParseGrpcTarget(string endpoint)
        {
            if (string.IsNullOrWhiteSpace(endpoint))
                throw new InvalidOperationException("Avatar gRPC endpoint 不能为空");
            const string prefix = "grpc://";
            if (!endpoint.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Avatar endpoint 必须使用 grpc:// 回环地址");
            var target = endpoint.Substring(prefix.Length);
            if (!target.StartsWith("127.0.0.1:", StringComparison.Ordinal))
                throw new InvalidOperationException("Avatar gRPC endpoint 必须绑定 127.0.0.1");
            return target;
        }
    }
}
