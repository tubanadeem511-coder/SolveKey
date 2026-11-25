import type { SVGProps } from "react";

interface SolveKeyLogoProps {
  variant?: "full" | "icon" | "compact";
  showTagline?: boolean;
  theme?: "light" | "dark" | "auto";
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

type SolveKeyGlyphProps = SVGProps<SVGSVGElement> & {
  tone?: "light" | "dark" | "auto";
};

export function SolveKeyGlyph({
  className = "size-10",
  tone = "auto",
  ...props
}: SolveKeyGlyphProps) {
  const primary = tone === "light" ? "#FFFFFF" : tone === "dark" ? "#092553" : "currentColor";
  const colorClass = tone === "auto" ? "text-[#092553] dark:text-white" : "";

  return (
    <svg
      aria-hidden="true"
      className={`block shrink-0 ${colorClass} ${className}`}
      fill="none"
      focusable="false"
      viewBox="0 0 64 64"
      {...props}
    >
      <path
        d="M47 13c-7-5-17-6-24-1-8 5-10 14-4 20 4 4 11 6 19 9 10 3 15 8 12 15-3 7-11 10-19 9-6 0-11-2-15-6"
        stroke={primary}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="8"
      />
      <path
        d="M34 33h16"
        stroke="#08A982"
        strokeLinecap="round"
        strokeWidth="5"
      />
      <circle cx="52" cy="33" r="3.5" fill="#08A982" />
    </svg>
  );
}

export function SolveKeyLogo({
  variant = "full",
  showTagline = true,
  theme = "auto",
  size = "md",
  className = "",
}: SolveKeyLogoProps) {
  const dimensions = {
    sm: { icon: "size-9 sm:size-10", mark: "size-10 sm:size-11", logo: "w-[158px] sm:w-[180px]" },
    md: { icon: "size-11 sm:size-12", mark: "size-12 sm:size-14", logo: "w-[190px] sm:w-[218px]" },
    lg: { icon: "size-14 sm:size-16", mark: "size-16 sm:size-[4.5rem]", logo: "w-[230px] sm:w-[260px]" },
    xl: { icon: "size-16 sm:size-20", mark: "size-20 sm:size-24", logo: "w-[270px] sm:w-[300px]" },
  };
  const selectedSize = dimensions[size];
  const primary = theme === "dark" ? "#FFFFFF" : "#082B83";
  const autoDarkFill = theme === "auto" ? "dark:fill-white" : "";
  const glyphTone = theme === "dark" ? "light" : theme === "light" ? "dark" : "auto";

  if (variant === "icon") {
    return <SolveKeyGlyph className={`${selectedSize.icon} ${className}`} tone={glyphTone} />;
  }

  return (
    <div className={`inline-flex min-w-0 flex-col ${className}`}>
      <div className={`inline-flex min-w-0 items-center ${selectedSize.logo}`}>
        <img
          alt=""
          aria-hidden="true"
          className={`${selectedSize.mark} block shrink-0 object-contain`}
          src="/solvekey-favicon.png"
        />
        <svg
          aria-label="SolveKey"
          className="block h-auto min-w-0 flex-1"
          focusable="false"
          role="img"
          viewBox="400 0 1270 470"
          xmlns="http://www.w3.org/2000/svg"
        >
          <text
            x="420"
            y="330"
            className={autoDarkFill}
            fill={primary}
            fontFamily="Arial Black, Arial, Helvetica, sans-serif"
            fontSize="290"
            fontWeight="800"
            letterSpacing="-17"
            textLength="690"
            lengthAdjust="spacingAndGlyphs"
          >
            Solve
          </text>
          <text
            x="1140"
            y="330"
            fill="#00A879"
            fontFamily="Arial Black, Arial, Helvetica, sans-serif"
            fontSize="290"
            fontWeight="800"
            letterSpacing="-17"
            textLength="500"
            lengthAdjust="spacingAndGlyphs"
          >
            Key
          </text>
        </svg>
      </div>
      {variant === "full" && showTagline && (
        <span className="mt-1 whitespace-nowrap text-[9px] font-semibold uppercase tracking-[0.13em] text-[#64748B] dark:text-slate-400">
          Report · Resolve · Improve
        </span>
      )}
    </div>
  );
}
