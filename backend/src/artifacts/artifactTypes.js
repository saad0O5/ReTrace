const SUPPORTED_ARTIFACT_TYPES = {
  PAPER: { value: "PAPER", label: "Paper" },
  IMPLEMENTATION: { value: "IMPLEMENTATION", label: "Implementation" },
  DATASET: { value: "DATASET", label: "Dataset" },
  BENCHMARK: { value: "BENCHMARK", label: "Benchmark" },
  RESOURCE: { value: "RESOURCE", label: "Resource" },
  PROJECT: { value: "PROJECT", label: "Project" },
};

function normalizeArtifactType(typeValue) {
  if (!typeValue && typeValue !== 0) return "UNKNOWN";
  const normalized = String(typeValue).trim().toUpperCase();
  if (Object.prototype.hasOwnProperty.call(SUPPORTED_ARTIFACT_TYPES, normalized)) {
    return normalized;
  }
  return "UNKNOWN";
}

function isSupportedArtifactType(typeValue) {
  return Object.prototype.hasOwnProperty.call(
    SUPPORTED_ARTIFACT_TYPES,
    normalizeArtifactType(typeValue)
  );
}

function getArtifactTypeLabel(typeValue) {
  const normalized = normalizeArtifactType(typeValue);
  const entry = SUPPORTED_ARTIFACT_TYPES[normalized];
  return entry ? entry.label : "Unknown";
}

function getSupportedArtifactTypes() {
  return Object.values(SUPPORTED_ARTIFACT_TYPES).map((entry) => entry.value);
}

module.exports = {
  SUPPORTED_ARTIFACT_TYPES,
  normalizeArtifactType,
  isSupportedArtifactType,
  getArtifactTypeLabel,
  getSupportedArtifactTypes,
};
