import type { IconProps } from './icons/props.ts'
import { tflowBuddyArtwork } from './tflow-buddy-artwork.ts'

/**
 * Render the TFlowBuddy robot as a decorative sidebar mark.
 * @param props - Square size in pixels and optional placement class.
 * @returns the bundled robot image; no network request is needed.
 */
export function TFlowLogo({ size = 24, className }: IconProps) {
  return (
    <img src={tflowBuddyArtwork} width={size} height={size} className={className}
      alt="" aria-hidden="true" draggable={false} style={{ borderRadius: '22%' }} />
  )
}
