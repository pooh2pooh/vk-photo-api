import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

/** Общие атрибуты для всех иконок: контурный стиль, размер и currentColor. */
const base: IconProps = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
};

/** Выход из аккаунта. */
export function IconLogout(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

/** Обновить данные. */
export function IconRefresh(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

/** Крупные превью (обычный вид). */
export function IconGridLarge(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.4" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.4" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.4" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.4" />
    </svg>
  );
}

/** Мелкие превью («Обзор»). */
export function IconGridSmall(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="3" width="4.6" height="4.6" rx="1.1" />
      <rect x="9.7" y="3" width="4.6" height="4.6" rx="1.1" />
      <rect x="16.4" y="3" width="4.6" height="4.6" rx="1.1" />
      <rect x="3" y="9.7" width="4.6" height="4.6" rx="1.1" />
      <rect x="9.7" y="9.7" width="4.6" height="4.6" rx="1.1" />
      <rect x="16.4" y="9.7" width="4.6" height="4.6" rx="1.1" />
      <rect x="3" y="16.4" width="4.6" height="4.6" rx="1.1" />
      <rect x="9.7" y="16.4" width="4.6" height="4.6" rx="1.1" />
      <rect x="16.4" y="16.4" width="4.6" height="4.6" rx="1.1" />
    </svg>
  );
}

/** Стрелка влево (пагинация, навигация). */
export function IconChevronLeft(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

/** Стрелка вправо (пагинация, навигация). */
export function IconChevronRight(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
