type Props = {
  size?: number;
  "aria-hidden"?: boolean;
  className?: string;
};

/**
 * The pod icon (DESIGN.md, "C2 · back rim"): a puck whose cap front and body use the text
 * colour, while the back rim of the cap is lit in `--pod-glow`. Containers decide when it glows by
 * setting `--pod-glow` (the tab bar keeps it at `currentColor` for inactive tabs).
 */
export function PodIcon({ size = 24, className, ...rest }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`lucide pod-icon${className ? ` ${className}` : ""}`}
      {...rest}
    >
      <path d="M4 12a8 3 0 0 0 16 0M4 12v4a8 3 0 0 0 16 0v-4" />
      <path d="M4 12a8 3 0 0 1 16 0" stroke="var(--pod-glow)" />
    </svg>
  );
}
