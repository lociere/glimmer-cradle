using System;
using UnityEngine;

namespace GlimmerCradle.Avatar
{
    public static class WavUtility
    {
        public static AudioClip FromBase64(string base64, string clipName)
        {
            try
            {
                return FromBytes(Convert.FromBase64String(base64), string.IsNullOrWhiteSpace(clipName) ? "avatar-audio" : clipName);
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[UnityAvatarHost] WAV base64 解码失败: {ex.Message}");
                return null;
            }
        }

        private static AudioClip FromBytes(byte[] wav, string clipName)
        {
            if (wav == null || wav.Length < 44)
            {
                return null;
            }

            var channels = BitConverter.ToInt16(wav, 22);
            var sampleRate = BitConverter.ToInt32(wav, 24);
            var bitsPerSample = BitConverter.ToInt16(wav, 34);
            var dataOffset = FindChunk(wav, "data");
            if (dataOffset < 0)
            {
                return null;
            }

            var dataSize = BitConverter.ToInt32(wav, dataOffset + 4);
            var audioStart = dataOffset + 8;
            var sampleCount = dataSize / (bitsPerSample / 8);
            var samples = new float[sampleCount];

            if (bitsPerSample == 16)
            {
                for (var i = 0; i < sampleCount; i++)
                {
                    samples[i] = BitConverter.ToInt16(wav, audioStart + i * 2) / 32768f;
                }
            }
            else if (bitsPerSample == 32)
            {
                for (var i = 0; i < sampleCount; i++)
                {
                    samples[i] = BitConverter.ToSingle(wav, audioStart + i * 4);
                }
            }
            else
            {
                Debug.LogWarning($"[UnityAvatarHost] 暂不支持 {bitsPerSample}bit WAV");
                return null;
            }

            var clip = AudioClip.Create(clipName, sampleCount / channels, channels, sampleRate, false);
            clip.SetData(samples, 0);
            return clip;
        }

        private static int FindChunk(byte[] wav, string chunkId)
        {
            for (var i = 12; i < wav.Length - 8; )
            {
                var id = System.Text.Encoding.ASCII.GetString(wav, i, 4);
                var size = BitConverter.ToInt32(wav, i + 4);
                if (id == chunkId)
                {
                    return i;
                }
                i += 8 + size;
            }
            return -1;
        }
    }
}
