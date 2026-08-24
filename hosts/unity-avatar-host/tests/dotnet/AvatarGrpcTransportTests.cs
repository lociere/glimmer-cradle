using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using GlimmerCradle.UnityAvatarHost.Adapters;
using Google.Protobuf;
using Grpc.Core;
using Xunit;
using Contract = GlimmerCradle.Contracts.Glimmer.Avatar.V1;

namespace GlimmerCradle.UnityAvatarHost.Tests;

public sealed class AvatarGrpcTransportTests
{
    [Fact]
    public async Task ConnectCarriesAuthAndExchangesBinaryFrames()
    {
        const string token = "transport-test-token";
        var received = new TaskCompletionSource<Contract.AvatarUpstreamFrame>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        var method = new Method<Contract.AvatarUpstreamFrame, Contract.AvatarDownstreamFrame>(
            MethodType.DuplexStreaming,
            "glimmer.avatar.v1.AvatarHostService",
            "Connect",
            Marshallers.Create(value => value.ToByteArray(), Contract.AvatarUpstreamFrame.Parser.ParseFrom),
            Marshallers.Create(value => value.ToByteArray(), Contract.AvatarDownstreamFrame.Parser.ParseFrom));
        var service = ServerServiceDefinition.CreateBuilder()
            .AddMethod(method, async (requests, responses, context) =>
            {
                Assert.Equal(token, context.RequestHeaders.First(entry => entry.Key == "x-glimmer-avatar-token").Value);
                Assert.True(await requests.MoveNext(context.CancellationToken));
                received.TrySetResult(requests.Current);
                await responses.WriteAsync(new Contract.AvatarDownstreamFrame
                {
                    Kind = "ping",
                    Timestamp = 42,
                    TraceId = "trace-ping",
                });
            })
            .Build();
        var server = new Server { Services = { service }, Ports = { new ServerPort("127.0.0.1", 0, ServerCredentials.Insecure) } };
        server.Start();
        var port = server.Ports.Single().BoundPort;
        using var lifetime = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        using var transport = new AvatarGrpcTransport();
        try
        {
            await transport.ConnectAsync($"grpc://127.0.0.1:{port}", token, lifetime.Token);
            var downstream = new TaskCompletionSource<Contract.AvatarDownstreamFrame>(
                TaskCreationOptions.RunContinuationsAsynchronously);
            var receive = transport.ReceiveAsync(frame => downstream.TrySetResult(frame), lifetime.Token);
            await transport.WriteAsync(new Contract.AvatarUpstreamFrame
            {
                Kind = "host_hello",
                Timestamp = 41,
                HostHello = new Contract.AvatarHostHelloPayload { HostKind = "unity" },
            }, lifetime.Token);

            Assert.Equal("host_hello", (await received.Task).Kind);
            Assert.Equal("trace-ping", (await downstream.Task).TraceId);
            await transport.ShutdownAsync();
            try
            {
                await receive;
            }
            catch (RpcException closed)
            {
                Assert.Equal(StatusCode.Cancelled, closed.StatusCode);
            }
        }
        finally
        {
            await server.ShutdownAsync();
        }
    }
}
