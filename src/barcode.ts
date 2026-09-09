import { BarcodeFormat, BrowserMultiFormatReader } from "@zxing/browser";

// Client-side barcode decoding for ticket imports (roadmap features 18/19, Phase 6). QR,
// PDF417, Aztec, Code 128 and Data Matrix are all open standards -- decoding them needs no
// issuer account or network call, just a decoder library, matching the same "processed in this
// browser, not uploaded to a third party" convention already used for OCR in
// src/components/Scanner.tsx. This never verifies a ticket against any issuer or carrier
// system; it only reads whatever text is encoded in the barcode, exactly like a person reading
// the confirmation code printed under it.
export interface DecodedBarcode {
  format: string;
  text: string;
}
let reader: BrowserMultiFormatReader | null = null;
function getReader() {
  if (!reader) reader = new BrowserMultiFormatReader();
  return reader;
}
// Returns null (not a rejection) when no supported barcode is found in the image -- that is an
// entirely normal outcome (a photo of a paper ticket with no barcode, a blurry shot, or a
// carrier that doesn't use one) and callers should let the import continue without one, not
// treat it as a failure.
export async function decodeBarcodeFromImage(
  image: HTMLImageElement,
): Promise<DecodedBarcode | null> {
  try {
    const result = await getReader().decodeFromImageElement(image);
    return { format: BarcodeFormat[result.getBarcodeFormat()], text: result.getText() };
  } catch {
    return null;
  }
}
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error ?? new Error("Could not read the file."));
    fr.readAsDataURL(file);
  });
}
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load the image."));
    img.src = url;
  });
}
