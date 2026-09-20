import { Linking } from "react-native";
import { WEB_BASE_URL } from "./config";

/** Section 29 Part D: Terms/Privacy are real pages on the web app, not duplicated natively --
 * one canonical source of truth instead of two copies that can drift out of sync. */
export function openTerms() {
  Linking.openURL(`${WEB_BASE_URL}/terms`);
}

export function openPrivacy() {
  Linking.openURL(`${WEB_BASE_URL}/privacy`);
}
