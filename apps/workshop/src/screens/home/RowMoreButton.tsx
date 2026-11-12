// Native: the home row's actions open by long-press (and, later, swipe), so
// there is no trailing "more" control. The web variant is RowMoreButton.web.tsx.
export interface RowMoreButtonProps {
  visible: boolean;
  label: string;
  onPress: () => void;
  onActiveChange: (key: "hover" | "focus", active: boolean) => void;
  testID?: string;
}

export function RowMoreButton(_props: RowMoreButtonProps) {
  return null;
}
