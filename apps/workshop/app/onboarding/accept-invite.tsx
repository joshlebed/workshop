import { type Href, Redirect, useLocalSearchParams } from "expo-router";
import { LinkErrorScreen } from "../../src/screens/LinkErrorScreen";

/**
 * Old in-app path for invite links. The landing now lives at
 * `/invite/:token`, which shows the list and asks before joining (4.6).
 */
export default function AcceptInviteRedirect() {
  const params = useLocalSearchParams<{ token?: string }>();
  const token = (Array.isArray(params.token) ? params.token[0] : params.token)?.trim();
  if (!token) {
    return (
      <LinkErrorScreen
        title="This link is incomplete"
        message="It's missing the part that names the list. Ask whoever sent it to share it again."
      />
    );
  }
  return <Redirect href={`/invite/${encodeURIComponent(token)}` as Href} />;
}
