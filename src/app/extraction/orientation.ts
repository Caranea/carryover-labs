export interface OrientationHint { turns: 0 | 1 | 2 | 3; confident: boolean }

/** A low-confidence angle is a candidate to validate with OCR, not a rotation to trust. */
export function orientationHint(data: {
  orientation_degrees: number | null;
  orientation_confidence: number | null;
}): OrientationHint | null {
  const { orientation_degrees: degrees, orientation_confidence: confidence } = data;
  if (confidence === null || !Number.isFinite(confidence) || confidence <= 0
    || degrees === null || ![0, 90, 180, 270].includes(degrees)) return null;
  // Tesseract reports the clockwise correction, not the image's original angle.
  return { turns: (degrees / 90) as OrientationHint['turns'], confident: confidence >= 10 };
}
