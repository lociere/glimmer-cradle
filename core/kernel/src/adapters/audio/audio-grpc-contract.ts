import type { DescMessage, MessageShape } from '@bufbuild/protobuf';
import { fromBinary, toBinary } from '@bufbuild/protobuf';
import type { MethodDefinition } from '@grpc/grpc-js';

export function audioUnaryMethod<I extends DescMessage, O extends DescMessage>(
  name: string,
  input: I,
  output: O,
): MethodDefinition<MessageShape<I>, MessageShape<O>> {
  return {
    path: `/glimmer.engine.audio.v1.AudioEngineService/${name}`,
    requestStream: false,
    responseStream: false,
    requestSerialize: (value) => Buffer.from(toBinary(input, value)),
    requestDeserialize: (value) => fromBinary(input, value),
    responseSerialize: (value) => Buffer.from(toBinary(output, value)),
    responseDeserialize: (value) => fromBinary(output, value),
  };
}
