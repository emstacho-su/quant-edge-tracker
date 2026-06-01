/**
 * Per-book paste-sample fixtures for offshore slate upload tests.
 *
 * Each constant is a placeholder until the user pastes a real slate from that book.
 * See RESEARCH.md Open Q #3 and Assumption A1 — paste grammars are partially unknown.
 * Replace each __TBD__USER_TO_PASTE__ block with one real paste sample before
 * 21-02 can turn the parser tests green.
 */

// Real 7stacks slate paste captured 2026-05-27.
// Format: date header, 4-line column header (Spread / ML / Total / Team Total),
// then per-game block: "<H:MM> <AM|PM> <Away> - <Home>", blank, two 6-line team
// blocks (rotation-number header + spread + ML + game total + team total over +
// team total under). Blank ML line = no moneyline offered for that team.
export const sevenStacksSample = `5/27 Game
Spread  ($1,000)
ML  ($1,000)
Total  ($1,000)
Team Total  ($1,000)
1:40 PM STL Cardinals - MIL Brewers

901  STL Cardinals D May
+1½ -152
+143
o8 -116
o3.5 -115
u3.5 -115

902  MIL Brewers C Patrick
-1½ +132
-163
u8 -104
o4.5 100
u4.5 -130
3:45 PM ARI Diamondbacks - SF Giants

903  ARI Diamondbacks M Soroka
-1½ +145
-120
o7½ -110
o3.5 -135
u3.5 105

904  SF Giants T McDonald
+1½ -165
Even
u7½ -110
o3.5 100
u3.5 -130
4:10 PM PHI Phillies - SD Padres

905  PHI Phillies C Sanchez
-1½ +130
-135
o7 -110
o3.5 -140
u3.5 110

906  SD Padres W Buehler
+1½ -150
+115
u7 -110
o2.5 -145
u2.5 115
6:40 PM CHI Cubs - PIT Pirates

907  CHI Cubs J Taillon
+1½ -203
Even
o8½ -120
o4.5 -105
u4.5 -125

908  PIT Pirates B Chandler
-1½ +173
-120
u8½ Even
o4.5 105
u4.5 -135
7:10 PM CIN Reds - NY Mets

909  CIN Reds A Abbott
+1½ -222
Even
o8 -118
o3.5 -135
u3.5 105

910  NY Mets H Brazoban
-1½ +187
-120
u8 -102
o3.5 -140
u3.5 110
10:10 PM COL Rockies - LA Dodgers

911  COL Rockies T Sugano
+1½ +150

o8 -110
o2.5 -110
u2.5 -120

912  LA Dodgers S Ohtani
-1½ -175

u8 -110
o5.5 105
u5.5 -135
3:05 PM SEA Mariners - Athletics

913  SEA Mariners L Gilbert
-1½ +132
-125
o9 -109
o4.5 -120
u4.5 -110

914 Athletics J Springs
+1½ -152
+105
u9 -111
o4.5 115
u4.5 -145
6:35 PM TB Rays - BAL Orioles

915  TB Rays S Matz
-1½ +152
-111
o9 -110
o4.5 -110
u4.5 -120

916  BAL Orioles Undecided
+1½ -177
-109
u9 -110
o4.5 100
u4.5 -130
6:40 PM LA Angels - DET Tigers

917  LA Angels J Soriano
+1½ -215
-109
o7½ -110
o3.5 -115
u3.5 -115

918  DET Tigers C Mize
-1½ +180
-111
u7½ -110
o3.5 -125
u3.5 -105
7:40 PM NY Yankees - KC Royals

919  NY Yankees G Cole
-1½ +105
-150
o9 Even
o4.5 -130
u4.5 100

920  KC Royals N Cameron
+1½ -125
+130
u9 -120
o3.5 -130
u3.5 100
7:40 PM MIN Twins - CHI White Sox

921  MIN Twins C Prielipp
+1½ -231
-110
o7½ -117
o3.5 -130
u3.5 100

922  CHI White Sox D Sandlin
-1½ +191
-110
u7½ -103
o3.5 -130
u3.5 100
8:05 PM HOU Astros - TEX Rangers

923  HOU Astros M Burrows
+1½ -175
+120
o7½ -105
o3.5 100
u3.5 -130

924  TEX Rangers J DeGrom
-1½ +150
-140
u7½ -115
o4.5 115
u4.5 -145
1:07 PM MIA Marlins - TOR Blue Jays

925  MIA Marlins E Perez
+1½ -163
+130
o7½ -105
o3.5 -105
u3.5 -125

926  TOR Blue Jays K Gausman
-1½ +143
-150
u7½ -115
o4.5 115
u4.5 -145
1:10 PM WAS Nationals - CLE Guardians

927  WAS Nationals PJ POULIN
+1½ -135
+160
o8 Even
o3.5 105
u3.5 -135

928  CLE Guardians G Williams
-1½ +115
-185
u8 -120
o4.5 -105
u4.5 -125
6:45 PM ATL Braves - BOS Red Sox

929  ATL Braves B Elder
-1½ +158
-105
o8½ -105
o4.5 105
u4.5 -135

930  BOS Red Sox C Early
+1½ -183
-115
u8½ -115
o3.5 -125
u3.5 -105`

// __TBD__USER_TO_PASTE__ betvegas23 slate — replace with one real paste before 21-02 turns green
export const betvegas23Sample = `__TBD__USER_TO_PASTE__betvegas23`

// __TBD__USER_TO_PASTE__ bovada slate — replace with one real paste before 21-02 turns green
export const bovadaSample = `__TBD__USER_TO_PASTE__bovada`

// __TBD__USER_TO_PASTE__ betus slate — replace with one real paste before 21-02 turns green
export const betusSample = `__TBD__USER_TO_PASTE__betus`

/**
 * The fixed offshore book set (D-11). Keeps test loops aligned with
 * ALLOWED_BOOKS on the route.
 */
export const FIXTURE_BOOKS = ['7stacks', 'betvegas23', 'bovada', 'betus'] as const

export type FixtureBook = (typeof FIXTURE_BOOKS)[number]

/**
 * Returns true only when the matching sample has been replaced with real paste text.
 * Parser tests call this and use it.skip for books whose sample is still placeholder,
 * so the suite reports skipped (yellow) on unsupplied samples rather than
 * misleadingly green on __TBD__ text.
 */
export function hasRealSample(book: FixtureBook): boolean {
  const sampleMap: Record<FixtureBook, string> = {
    '7stacks': sevenStacksSample,
    betvegas23: betvegas23Sample,
    bovada: bovadaSample,
    betus: betusSample,
  }
  return !sampleMap[book].includes('__TBD__USER_TO_PASTE__')
}
