// Old deep link — the users web now lives on the Users tab of /admin.
import { Redirect } from "expo-router";

export default function AdminGraphRedirect() {
  return <Redirect href="/admin?tab=users" />;
}
