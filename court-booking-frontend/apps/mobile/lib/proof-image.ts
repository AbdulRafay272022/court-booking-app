import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { Platform } from "react-native";

import { jpegName, PROOF_JPEG_QUALITY, proofResize } from "./proof-image-rules";

export interface PreparedProof {
  uri: string;
  /** Expo web only: RN-web's FormData cannot send a `{ uri }` part, it needs the real Blob. */
  blob?: Blob;
  name: string;
  type: string;
}

/** Shrink (long side <= 1600 px) and re-encode a picked image as JPEG before upload. If the manipulator fails (an odd
 * format), fall back to the original file rather than blocking the payment. */
export async function prepareProofImage(asset: {
  uri: string;
  width?: number;
  height?: number;
  file?: Blob;
  fileName?: string | null;
  mimeType?: string | null;
}): Promise<PreparedProof> {
  const original: PreparedProof = {
    uri: asset.uri,
    blob: asset.file,
    name: asset.fileName ?? "proof.jpg",
    type: asset.mimeType ?? "image/jpeg",
  };
  try {
    const resize = proofResize(asset.width ?? 0, asset.height ?? 0);
    const out = await manipulateAsync(asset.uri, resize ? [{ resize }] : [], {
      compress: PROOF_JPEG_QUALITY,
      format: SaveFormat.JPEG,
    });
    const blob = Platform.OS === "web" ? await (await fetch(out.uri)).blob() : undefined;
    return { uri: out.uri, blob, name: jpegName(original.name), type: "image/jpeg" };
  } catch {
    return original;
  }
}
