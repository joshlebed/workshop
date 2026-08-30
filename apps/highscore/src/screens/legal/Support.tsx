import { SUPPORT_EMAIL, SUPPORT_INTRO, SUPPORT_MAILTO, SUPPORT_SECTIONS } from "../../lib/legal";
import { LegalScreen } from "./LegalScreen";

export default function Support() {
  return (
    <LegalScreen
      testID="support-screen"
      eyebrow="Help"
      title="Support"
      intro={SUPPORT_INTRO}
      sections={SUPPORT_SECTIONS}
      contactLabel={`Email ${SUPPORT_EMAIL}`}
      contactUrl={SUPPORT_MAILTO}
    />
  );
}
