import { describe,it,expect } from 'vitest';
import { presentationDurationMs,projectileTravelSeconds } from '../src/scene/presentation';
describe('presentation timing',()=>{
 it.each([[false,false],[true,false],[false,true],[true,true]])('shows impact before presentation ends (fast=%s, reduced=%s)',(fast,reduced)=>{
  for(const result of ['miss','hit','sunk'] as const){
   const impact=projectileTravelSeconds(fast,reduced)*1000;
   expect(impact+100).toBeLessThan(presentationDurationMs(result,fast,reduced));
  }
 });
 it('keeps quick feedback below300ms and removes flight for reduced motion',()=>{
  expect(presentationDurationMs('sunk',true,false)).toBeLessThan(300);
  expect(projectileTravelSeconds(false,true)).toBe(0);
 });
});
