import type { IconProps } from './icons/props.ts'

/**
 * Render the TFlow app badge as a decorative sidebar mark.
 * @param props - Square size in pixels and optional placement class.
 * @returns the TFlow badge SVG.
 */
export function TFlowLogo({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 1024 1024" fill="none" aria-hidden="true">
      <rect width="1024" height="1024" rx="224" fill="#071827" />
      <path d="M220 222h584a48 48 0 0 1 48 48v360a48 48 0 0 1-48 48H592l-80 124-80-124H220a48 48 0 0 1-48-48V270a48 48 0 0 1 48-48Z" fill="#14b8a6" />
      <path d="M310 376h404M512 376v272" stroke="#fff" strokeWidth="70" strokeLinecap="round" />
      <path d="M350 712h324" stroke="#d9fffa" strokeWidth="18" strokeLinecap="round" />
    </svg>
  )
}
