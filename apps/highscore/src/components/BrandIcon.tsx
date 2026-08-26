import { Image } from "react-native";

const ICON_SOURCE = require("../../assets/icon-source.png");

interface BrandIconProps {
  size: number;
}

export function BrandIcon({ size }: BrandIconProps) {
  return (
    <Image
      accessible={false}
      accessibilityIgnoresInvertColors
      resizeMode="contain"
      source={ICON_SOURCE}
      style={{ width: size, height: size }}
    />
  );
}
