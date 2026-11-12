import {
  PRIVACY_EFFECTIVE_DATE,
  PRIVACY_INTRO,
  PRIVACY_MAILTO,
  PRIVACY_SECTIONS,
  SUPPORT_EMAIL,
} from "../src/lib/legal";
import { LegalScreen } from "../src/screens/legal/LegalScreen";

/** `/privacy`: public, renders signed out (4.5). */
export default function Privacy() {
  return (
    <LegalScreen
      testID="privacy-screen"
      title="Privacy"
      intro={PRIVACY_INTRO}
      effectiveDate={PRIVACY_EFFECTIVE_DATE}
      sections={PRIVACY_SECTIONS}
      contactLabel={`Email ${SUPPORT_EMAIL}`}
      contactUrl={PRIVACY_MAILTO}
    />
  );
}
