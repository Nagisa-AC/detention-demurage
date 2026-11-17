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

export class StitchFailure extends Error {
  constructor() {
    super("The pages could not be stitched.");
    this.name = "StitchFailure";
  }
}

export class NormalizeError extends Error {
  constructor() {
    super("The invoice could not be normalized.");
    this.name = "NormalizeError";
  }
}
