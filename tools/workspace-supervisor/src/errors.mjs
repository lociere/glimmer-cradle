export class SupervisorUsageError extends Error {
  constructor(message) {
    super(message);
    this.exitCode = 64;
  }
}

export class SupervisorInputError extends Error {
  constructor(message) {
    super(message);
    this.exitCode = 66;
  }
}

export class PackageManagerUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.exitCode = 69;
  }
}

export class ChildExitError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.exitCode = Number.isInteger(exitCode) && exitCode > 0 ? exitCode : 1;
  }
}
