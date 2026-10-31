// Old deep link — the analytics now live on the Overview tab of /admin.
import { Redirect } from "expo-router";

export default function AdminAnalyticsRedirect() {
  return <Redirect href="/admin?tab=overview" />;
}
