// The one group every variant shares.
//
// ux1, ux4 and ux5 push real screens in here; ux2 mounts its persistent
// `<Shell />` and ux3 its timeline + sheet host, with child routes that render
// nothing. Which of those it is comes from the active variant — see
// `src/ux/shells.tsx`.
import { VariantGroupLayout } from "../../src/ux/shells";

export default function AppGroupLayout() {
  return <VariantGroupLayout />;
}
