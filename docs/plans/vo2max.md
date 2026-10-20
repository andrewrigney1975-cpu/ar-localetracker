# VO2max estimate from watch heart rate and phone GPS: research

Status: **A1 (HUNT submaximal) and the heart-rate checks are built** (2026-10-20), for
**walks only**: on the City2Surf sample run (6:18/km) A1 gave 60, against ~35 from race-pace
tables, because the model is linear in speed and was fitted on walkers. Stretches over
8.5 km/h are also left out. Runs need A2 (or a running-specific model). Built:
`src/stats/vo2max.js`, a tile on the workout Summary, and the 4-week median in Settings →
Profile. The rest of this document is the research it came from; waist, the non-exercise
models and A2 are still to do.

Built as: 5-min stretches after 10 min of active time, moving, one segment, ≤ 10 s gaps;
speed ≥ 0.8 m/s with CV ≤ 15%; slope −2%…+8% (downhill counts as flat); heart rate over the
last 2 min of each stretch: ≥ 80% coverage, no ≥ 15 bpm jump within 2 s, SD ≤ 8, at least
resting + 15, at most 85% of peak (profile max HR, else the HUNT age formula). At least 2
stretches; stretches > 3 MAD (MAD ≥ 1) from the median are dropped; the workout's value is
the median. On the owner's Lake Loop walks: 40.7–44.9 per walk, 4-week median 42.9; the
18 Oct walk lost 15 of 21 stretches to "heart rate too high".

Cadence lock check (added with step cadence, 2026-10-20): a stretch whose heart rate is within
3 bpm of the step cadence for ≥ 80% of its readings is suspect; suspects are dropped only when
they are at most half of the workout's passing stretches (a lock comes and goes; heart rate
near the step rate all workout is taken as genuine, which is common for brisk walking).

## 1. Goal

Estimate VO2max (ml·kg⁻¹·min⁻¹) from what Locale already records: Pixel Watch heart rate
streamed during the workout, phone GPS speed and distance, and barometric elevation. Use
several independent methods so they can be combined and checked against each other. A
waist measurement in the profile unlocks two more methods.

## 2. What Locale already has

| Input | Where | Note |
|---|---|---|
| HR per track point | `track.hr` (watch via Health Services) | Optical, wrist |
| Speed, distance, moving flag | `track.speed`, `track.dist`, `track.moving` | Kalman/RTS smoothed |
| Elevation and grade | `track.alt` (baro + GNSS fusion), `gradeAt()` in `stats/physio.js` | Baro gives good relative grade |
| Age, sex, height, weight | `settings.profile` | |
| Resting HR | `profile.restingHr` (typed in; default 60) | Not measured by the app |
| Max HR | `profile.maxHr`, else Tanaka 208 − 0.7 × age | Estimated max HR is the largest error source |
| Waist | **missing**. Needs a `profile.waistCm` field | |

## 3. Candidate methods

### A. Submaximal exercise models (use each workout's HR at a steady speed)

**A1. HUNT 3 submaximal model** (Loe et al. 2016, PLoS ONE; n ≈ 4,600 Norwegians aged 20–90,
92% *walked* at the submaximal stage). Steady state (≥ 3 min, below the ventilatory threshold),
treadmill speed v (km/h), incline i (%), HR at that stage:

- Men: `35.25 + 1.276·i + 6.402·v − 0.196·kg − 27.615·HR/(215.336 − 0.73·age)`
- Women: `23.77 + 1.205·i + 6.051·v − 0.160·kg − 20.671·HR/(212.497 − 0.702·age)`
- SEE 6.24 (men) / 5.17 (women) ml·kg⁻¹·min⁻¹ (~14%). R² 0.55–0.56.

This is the best fit for Locale's data: a walking population, and it uses only speed, grade,
HR, weight and age. It doesn't need max HR (it uses its own age formula) or resting HR.
Caveats: treadmill vs outdoor (wind, surface); HR drift late in long walks.

**A2. HR reserve extrapolation** (the Firstbeat/Garmin and Apple family). %HRR ≈ %VO2R
(Swain & Leutholtz). Each steady stretch gives VO2 from a walking/running energy-cost equation
and %HRR = (HR − HRrest)/(HRmax − HRrest), so `VO2max = 3.5 + (VO2 − 3.5)/%HRR`. Combine many
stretches, or regress HR on VO2 across speeds and extrapolate to HRmax.

- The energy-cost equation matters a great deal. The **ACSM walking equation**
  (3.5 + 0.1·S + 1.8·S·G, S in m/min) is meant for 50–100 m/min. At brisk walking speed it
  underestimates the cost badly (see §5). Use a model with a speed² term for walking, e.g.
  **Pandolf (1977)** or the newer **LCDA (Looney et al. 2019)**, and **ACSM running**
  (0.2·S + 0.9·S·G + 3.5) only for running ≥ 134 m/min. Reviews report the ACSM running
  equation overestimates VO2max by ~10–18%.
- Highly sensitive to HRmax: Firstbeat reports ~5% MAPE with a known HRmax, ~7–9% when HRmax
  is off by 15 bpm. A low walking %HRR (~65%) means a long extrapolation, which magnifies errors.
- Vendor results for comparison: Firstbeat (running) ~5% MAPE in its own study; independent
  studies range from ~8% to "unsatisfactory". Apple Watch: MAPE ~13% (Lambe 2025),
  ~15% (Caserman 2024), with underestimation and poor reliability.

**A3. Rockport 1-mile walk** (Kline 1987): needs a maximal-effort brisk mile with the HR at
the end. `139.168 − 0.388·age − 0.077·lb − 3.265·min − 0.156·HR (+ 6.318 men)`. Original SEE
~5 ml·kg⁻¹·min⁻¹, but later studies found 16–23% overestimation in young adults. Usable for
any walk containing a fast mile, but the equation assumes the subject was walking as fast as
possible.

**A4. Cooper 12-min run**: `(m − 504.9)/44.73`. Only for an all-out 12 minutes, which the
user would have to choose to do. Possible as an optional "fitness test" mode later.

### B. Non-exercise models (profile only; anchors and sanity checks)

**B1. HUNT non-exercise model** (Nes et al. 2011, MSSE 43:2024): age, **waist**, resting HR,
leisure-time activity index (frequency × duration × intensity questions). SEE 5.70 (men),
5.14 (women); R² 0.61/0.56. **This is the method that needs waist.** The original coefficients
could not be retrieved (paywalled), and calculator sites quoting it disagree with each other, so
take the equation and activity-index scoring from the paper (PMID 21502897) before
implementing. The app can derive the activity index from recorded workouts instead of a
questionnaire.

**B2. Jackson et al. 1990**: age, sex, self-rated activity (PA-R) and either BMI or % body
fat:
- BMI form: `56.363 + 1.921·PAR − 0.381·age − 0.754·BMI + 10.987·(male)`
- %fat form: `50.513 + 1.589·PAR − 0.289·age − 0.522·%fat + 5.863·(male)`
- PA-R scale (0–7 in the original) to be confirmed from the paper. PA-R can be derived from
  recorded weekly activity. Known to drift by population (over- or under-predicts).

**B3. Relative fat mass** (Woolcott & Bergman 2018, Sci Rep; NHANES, validated against DXA):
`%fat = 64 − 20·height/waist (+12 for women)`. With **waist + height** this feeds the %fat form
of B2. It is a second use of the waist measurement, and tracks body fat better than BMI.

**B4. Heart-rate ratio** (Uth et al. 2004): `15.3 · HRmax/HRrest`. Derived from 46
well-trained men; SEE ~4.5% with measured HRmax, ~7.8% with age-predicted HRmax. Later work
suggests a factor nearer 14 for ordinary middle-aged men. It needs a good resting HR (the watch
could measure it overnight: see §6).

### C. External reference

Fitbit computes a "Cardio Fitness Score" (VO2max) on the Pixel Watch: a range from resting HR
and profile, or a value after ≥ 10-min flat GPS runs. If it is readable (Health Connect
`Vo2MaxRecord`; not confirmed that Fitbit writes it there), it is an independent check, not an
input.

## 4. Proposed combination

1. **Per workout** (walk/run only; never cycle or ski), find steady windows: ≥ 3–5 min
   after a 10 min warm-up, moving, speed CV < 15%, |grade| < 2% (or use the grade terms), HR
   present for most samples, HR lag ~30–60 s allowed for. Apply A1 and A2 to each window; use
   the median per workout.
2. **Quality gates**: drop windows where HR looks wrong. Watch for **cadence lock**: optical
   HR can read the arm-swing rhythm, and brisk-walking cadence (~125–135 steps/min) sits right
   in the HR range. Also drop sudden HR jumps and HR > 0.95·HRmax at walking pace.
3. **Running estimate**: combine methods by inverse-variance weighting with each one's
   published SEE (A1 ~6, A2 ~4–6, B-models ~5–6), over a rolling 4-week window of workout
   medians (robust median, then weighted mean).
4. **Validation**: report agreement. If the exercise-based (A) and profile-based (B)
   estimates differ by more than ~2 SEE, flag it ("check max HR / resting HR / waist"), not
   average blindly. When several walks of a routine exist, routine-to-routine spread is a
   direct reliability check (same course, same speed).
5. **Max HR calibration**: record the highest credible HR seen (sustained ≥ 30 s, quality
   gated) and offer to use it when it is above the age estimate. This cuts the biggest A2 error.

## 5. First test: the owner's Lake Loop 2 Laps walks (Oct 10–20, 2026)

Scratch script (`scratchpad/vo2/analyse.mjs`, not in the repo) on 10 walks with HR (the
10 Oct walk has none), 5-min steady windows after 10 min (14–22 per walk), profile: male,
51, 93 kg, resting HR 53, max HR estimated 172.

| Walk | Speed km/h | HR | A1 HUNT submax | A2 Pandolf cost | A2 ACSM cost |
|---|---:|---:|---:|---:|---:|
| 11 Oct | 7.29 | 135 | 42.6 | 32.2 | 21.7 |
| 12 Oct | 7.51 | 140 | 43.6 | 32.1 | 20.9 |
| 13 Oct | 7.29 | 134 | 42.8 | 32.4 | 21.7 |
| 14 Oct | 7.37 | 126 | 44.8 | 36.7 | 24.3 |
| 15 Oct | 7.19 | 132 | 42.7 | 33.3 | 22.3 |
| 16 Oct | 7.13 | 116 | 44.1 | 37.7 | 26.4 |
| 17 Oct | 7.27 | 140 | 41.7 | 30.3 | 20.6 |
| 18 Oct | 7.21 | 154 | 39.3 | 25.8 | 17.6 |
| 19 Oct | 7.12 | 134 | 41.9 | 31.5 | 21.3 |
| 20 Oct | 7.20 | 133 | 43.4 | 33.5 | 22.6 |
| **Median** | | | **42.8** | **32.3** | 21.7 |

B4 (Uth): 15.3 × 172/53 = 49.7.

Findings:
- **A1 is the steadiest** (39–45, SD ~1.6) and the most plausible.
- **A2 depends heavily on the cost model**: ACSM's walking equation gives ~22, which isn't
  credible at 7.3 km/h, beyond its range. Pandolf gives ~32. Both are long extrapolations from
  ~65% HRR with an *estimated* max HR. A measured max HR could move A2 by several units.
- **The HR at the same pace varies from 116 to 154 bpm** across walks. The 18 Oct walk
  (154 bpm) pulls every method down. That is either a real day effect (sleep, heat, fatigue)
  or optical error, possibly cadence lock. The quality gates in §4 are needed before any
  number is shown.
- Uth's ratio (49.7) is above all of them, as expected for a formula from trained men.
- The methods spread from ~32 to ~50 for the same person. **Show a range and a confidence
  level, not a single number**, until max HR is calibrated and the waist-based model is in.

## 6. What the user would add

- **Waist circumference** (cm, at the navel, relaxed). Unlocks B1 (HUNT non-exercise) and B3
  (RFM → %fat → B2). Store as `profile.waistCm`, metric internally, inches when imperial.
- **Activity level**: derivable from history (minutes/week by intensity from HR zones), so no
  questionnaire is needed. A manual override is optional.
- **Measured max HR** if known (field exists). Otherwise auto-calibration (§4.5).
- **Resting HR**: currently typed in. The watch could measure it (Health Services passive
  monitoring or a sleep minimum) for B4 and A2.

## 7. Open questions

- Exact HUNT non-exercise coefficients and PA-index scoring (needs the 2011 paper).
- Jackson PA-R scale (0–7?), to be confirmed from the 1990 paper.
- Whether Fitbit's cardio fitness value is readable from Health Connect on the Pixel Watch 3.
- LCDA vs Pandolf for brisk walking: check both against A1 on more walks.
- Pixel Watch 3 optical HR during brisk walking: no peer-reviewed validation found. Reviews
  report it close to a chest strap; other wrist devices show ~2.6–5.2 bpm error walking and
  4–6.5 running.

## Sources

- Loe et al. 2016, *Predicting VO2peak from Submaximal- and Peak Exercise Models: The HUNT 3
  Fitness Study*, PLoS ONE. https://pmc.ncbi.nlm.nih.gov/articles/PMC4721596/
- NTNU CERG, Fitness numbers. https://www.ntnu.edu/cerg/fitness-numbers
- Nes et al. 2011, *Estimating VO2peak from a Nonexercise Prediction Model: The HUNT Study*,
  MSSE 43(11). https://www.researchgate.net/publication/51060630
- Firstbeat, Fitness level (VO2max). https://www.firstbeat.com/en/science-and-physiology/fitness-level/
- U. Delaware, How accurate is your Garmin's VO2max estimate? https://sites.udel.edu/coe-engex/?p=1762
- Lambe et al. 2025, Apple Watch VO2max validation, PLoS ONE. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12080799/
- Caserman et al. 2024, Apple Watch Series 7 VO2max, JMIR Biomed Eng. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11325102/
- Uth et al. 2004, heart-rate ratio method. https://www.springermedizin.de/estimation-of-vo2max-from-the-ratio-between-hrmax-and-hrrest-the/8478242
- Rockport walk test. https://www.topendsports.com/testing/tests/rockport.htm
- Jackson et al. 1990 non-exercise equations. https://www.topendsports.com/testing/tests/non-exercise.htm
- ACSM running equation validity in athletes. https://www.hippokratia.gr/?p=1728
- Woolcott & Bergman 2018, relative fat mass. https://bioblast.at/index.php/Woolcott_2018_Sci_Rep
- Fitbit cardio fitness score API. https://dev.fitbit.com/build/reference/web-api/cardio-fitness-score/get-vo2max-summary-by-date/
- Wrist HR vs chest strap (bioRxiv). https://www.biorxiv.org/content/10.1101/2022.09.29.510075v1.full.pdf
- Pixel Watch 3 heart rate review. https://www.androidauthority.com/pixel-watch-3-heart-rate-3535889
- HR-speed extrapolation overview (Terra). https://tryterra.co/research/how-do-wearables-estimate-vo2max
