/** Render a labelled value without dropping false, 0, or empty states. */
export function formatLabelledValue(value) {
  if (value === false) return "No";
  if (value === true) return "Yes";
  if (value === 0) return "0";
  if (value === "" || value === null || value === undefined) return "None reported";
  return String(value);
}
