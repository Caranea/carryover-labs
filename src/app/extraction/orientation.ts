/** Tesseract.js reports the clockwise correction, not the image's original angle. */
export function orientationTurns(data: {
  orientation_degrees: number | null;
  orientation_confidence: number | null;
}): 0 | 1 | 2 | 3 | null {
  const { orientation_degrees: degrees, orientation_confidence: confidence } = data;
  if (confidence === null || !Number.isFinite(confidence) || confidence < 10
    || degrees === null || ![0, 90, 180, 270].includes(degrees)) return null;
  return (degrees / 90) as 0 | 1 | 2 | 3;
}
