/**
 * Whether a `codesign -dv --verbose=4` report means the app must be updated by hand: it is ad-hoc signed, or no
 * Developer ID Application certificate signed it. Squirrel.Mac only installs an update whose signature matches.
 */
export function isManualSignature(signature: string) {
  return /^Signature=adhoc\s*$/m.test(signature) || !/^Authority=Developer ID Application:/m.test(signature)
}
