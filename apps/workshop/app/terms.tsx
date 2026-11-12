import {
  SUPPORT_EMAIL,
  TERMS_EFFECTIVE_DATE,
  TERMS_INTRO,
  TERMS_MAILTO,
  TERMS_SECTIONS,
} from "../src/lib/legal";
import { LegalScreen } from "../src/screens/legal/LegalScreen";

/** `/terms`: public, renders signed out (4.5). */
export default function Terms() {
  return (
    <LegalScreen
      testID="terms-screen"
      title="Terms"
      intro={TERMS_INTRO}
      effectiveDate={TERMS_EFFECTIVE_DATE}
      sections={TERMS_SECTIONS}
      contactLabel={`Email ${SUPPORT_EMAIL}`}
      contactUrl={TERMS_MAILTO}
    />
  );
}
