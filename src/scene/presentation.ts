/** Keep impact onset inside the lifetime of every presentation mode. */
export function presentationDurationMs(result:'miss'|'hit'|'sunk',fast:boolean,reducedMotion:boolean):number {
  return fast||reducedMotion?220:result==='sunk'?1400:950;
}
export function projectileTravelSeconds(fast:boolean,reducedMotion:boolean):number {
  return reducedMotion?0:fast?.07:.27;
}
