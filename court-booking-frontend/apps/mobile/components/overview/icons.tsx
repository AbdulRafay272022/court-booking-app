import Svg, { Circle, Path, Rect } from "react-native-svg";

import type { IconProps } from "@/components/icons";

export function GridIcon({ size = 22, color = "#101C21", strokeWidth = 1.9 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="4" y="4" width="6.5" height="6.5" rx="1.5" stroke={color} strokeWidth={strokeWidth} />
      <Rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" stroke={color} strokeWidth={strokeWidth} />
      <Rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" stroke={color} strokeWidth={strokeWidth} />
      <Rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" stroke={color} strokeWidth={strokeWidth} />
    </Svg>
  );
}

export function ApprovalsIcon({ size = 22, color = "#101C21", strokeWidth = 1.9 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M5 12.5l4.5 4.5L19 7.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function LedgerTabIcon({ size = 22, color = "#101C21", strokeWidth = 1.9 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="5" y="3.5" width="14" height="17" rx="2" stroke={color} strokeWidth={strokeWidth} />
      <Path d="M8.5 9h7M8.5 12.5h7M8.5 16h4" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}

export function DotsIcon({ size = 22, color = "#101C21" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="5.5" cy="12" r="1.8" fill={color} />
      <Circle cx="12" cy="12" r="1.8" fill={color} />
      <Circle cx="18.5" cy="12" r="1.8" fill={color} />
    </Svg>
  );
}

export function CopyIcon({ size = 15, color = "#101C21", strokeWidth = 2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="9" y="9" width="11" height="11" rx="2" stroke={color} strokeWidth={strokeWidth} />
      <Path d="M5 15V6a2 2 0 012-2h9" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}

export function CloseIcon({ size = 18, color = "#101C21", strokeWidth = 2.2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M6 6l12 12M18 6L6 18" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}

export function AlertCircleIcon({ size = 14, color = "#8C3823", strokeWidth = 2.2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={strokeWidth} />
      <Path d="M12 7.5v5.5M12 16.2v.3" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
