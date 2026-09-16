import {
  SUPPORT_EMAIL,
  SUPPORT_MAILTO,
  TERMS_EFFECTIVE_DATE,
  TERMS_INTRO,
  TERMS_SECTIONS,
} from "../../lib/legal";
import { LegalScreen } from "./LegalScreen";

export default function Terms() {
  return (
    <LegalScreen
      testID="terms-screen"
      eyebrow="The rules"
      title="Terms of use"
      intro={TERMS_INTRO}
      effectiveDate={TERMS_EFFECTIVE_DATE}
      sections={TERMS_SECTIONS}
      contactLabel={`Email ${SUPPORT_EMAIL}`}
      contactUrl={SUPPORT_MAILTO}
      footnote="By signing in to HighScore you agree to these terms. They're written plainly by the person who runs the app."
    />
  );
}
