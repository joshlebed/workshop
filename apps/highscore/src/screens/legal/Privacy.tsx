import {
  PRIVACY_EFFECTIVE_DATE,
  PRIVACY_INTRO,
  PRIVACY_MAILTO,
  PRIVACY_SECTIONS,
  SUPPORT_EMAIL,
} from "../../lib/legal";
import { LegalScreen } from "./LegalScreen";

export default function Privacy() {
  return (
    <LegalScreen
      testID="privacy-screen"
      eyebrow="Your data"
      title="Privacy policy"
      intro={PRIVACY_INTRO}
      effectiveDate={PRIVACY_EFFECTIVE_DATE}
      sections={PRIVACY_SECTIONS}
      contactLabel={`Email ${SUPPORT_EMAIL}`}
      contactUrl={PRIVACY_MAILTO}
      footnote="Written in plain language by the person who runs HighScore. It describes what the app does, not legal advice."
    />
  );
}
