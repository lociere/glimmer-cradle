import type { DescMessage, MessageShape } from '@bufbuild/protobuf';
import { fromBinary, toBinary } from '@bufbuild/protobuf';
import type { MethodDefinition, ServiceDefinition } from '@grpc/grpc-js';

export function unaryMethod<I extends DescMessage, O extends DescMessage>(
  path: string,
  input: I,
  output: O,
): MethodDefinition<MessageShape<I>, MessageShape<O>> {
  return {
    path,
    requestStream: false,
    responseStream: false,
    requestSerialize: (value) => Buffer.from(toBinary(input, value)),
    requestDeserialize: (value) => fromBinary(input, value),
    responseSerialize: (value) => Buffer.from(toBinary(output, value)),
    responseDeserialize: (value) => fromBinary(output, value),
  };
}

export function serverStreamingMethod<I extends DescMessage, O extends DescMessage>(
  path: string,
  input: I,
  output: O,
): MethodDefinition<MessageShape<I>, MessageShape<O>> {
  return {
    path,
    requestStream: false,
    responseStream: true,
    requestSerialize: (value) => Buffer.from(toBinary(input, value)),
    requestDeserialize: (value) => fromBinary(input, value),
    responseSerialize: (value) => Buffer.from(toBinary(output, value)),
    responseDeserialize: (value) => fromBinary(output, value),
  };
}

export function duplexStreamingMethod<I extends DescMessage, O extends DescMessage>(
  path: string,
  input: I,
  output: O,
): MethodDefinition<MessageShape<I>, MessageShape<O>> {
  return {
    path,
    requestStream: true,
    responseStream: true,
    requestSerialize: (value) => Buffer.from(toBinary(input, value)),
    requestDeserialize: (value) => fromBinary(input, value),
    responseSerialize: (value) => Buffer.from(toBinary(output, value)),
    responseDeserialize: (value) => fromBinary(output, value),
  };
}

export function serviceDefinition(
  serviceName: string,
  methods: Record<string, readonly [DescMessage, DescMessage]>,
): ServiceDefinition {
  return Object.fromEntries(Object.entries(methods).map(([name, [input, output]]) => [
    name,
    unaryMethod(`/${serviceName}/${name}`, input, output),
  ]));
}
