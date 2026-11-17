export class ModelOutputError extends Error {
  constructor() {
    super("The model output is invalid.");
    this.name = "ModelOutputError";
  }
}

export class InferenceGeoError extends Error {
  constructor() {
    super("Inference ran outside the US.");
    this.name = "InferenceGeoError";
  }
}

export class GroundingError extends Error {
  constructor(cause?: unknown) {
    super("A page could not be grounded.", cause === undefined ? undefined : { cause });
    this.name = "GroundingError";
  }
}
