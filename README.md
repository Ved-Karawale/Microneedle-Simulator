# Microneedle-Simulator
This is a dense and highly specialized physics engine designed to model fluid wicking and drug release from polymer-based thin film coatings on complex structures. It accurately captures the transition from theoretical polymer physics to measurable dissolution metrics—exactly the kind of framework required when simulating advanced microneedle array patches (MAPs).

Let’s break down the mathematical models driving these calculations step-by-step.

### 1. Water Diffusion and Hydration (`effectiveDwater`)

Before a drug can release, the interstitial fluid (ISF) must penetrate the polymer matrix. The code calculates an effective diffusion coefficient for water ($D_{\text{water}}$) based on the molecular weight (grade) and concentration of the HPMC (hydroxypropyl methylcellulose) polymer.

The baseline diffusion is modified by two factors:


$$D_{\text{water}} = 10^{-10} \times \left(\frac{5}{\eta_{\text{ref}}}\right)^{0.28} \times \exp(-0.03 \cdot C_{\text{HPMC}})$$

* $\eta_{\text{ref}}$ is the reference viscosity of the chosen HPMC grade.
* $C_{\text{HPMC}}$ is the concentration of HPMC. Higher concentrations and higher molecular weight grades exponentially decrease water diffusivity.

### 2. Material Rheology & Surface Tension (`materialModel`)

To predict how the coating behaves when wet, the engine models the fluid properties of the dissolved film.

* **Viscosity:** Modeled using a power-law relationship based on polymer concentration:

$$\eta_{\text{visc}} = \eta_{\text{ref}} \times \left(\frac{C_{\text{HPMC}}}{2}\right)^{2.2}$$


* **Surface Tension:** Decreased logarithmically by the addition of the surfactant Tween 80:

$$\gamma = 72 - 35 \log_{10}\left(1 + \frac{C_{\text{Tween}}}{0.01}\right)$$


* **Superdisintegrant (SD) Gel Penalty:** If the superdisintegrant concentration exceeds a specific threshold, it forms a viscous gel that hinders release. The engine applies a penalty multiplier $0.75^{\Delta C}$, which acts as a barrier function.

### 3. Capillary Wicking (`simulateWicking`)

For porous or Triply Periodic Minimal Surface (TPMS) structures, the code calculates how fast fluid wicks into the geometry using a variation of the **Washburn equation** for capillary flow.

The engine calculates a capillary constant ($C$) for both the human Interstitial Fluid (ISF) and the liquid coating during manufacturing:


$$C = \frac{r_{\text{eff}} \cdot \gamma \cdot \cos(\theta)}{2 \cdot \eta \cdot \tau^2}$$

* $r_{\text{eff}}$ is the effective pore radius.
* $\gamma$ is surface tension, and $\eta$ is fluid viscosity.
* $\theta$ is the contact angle (wetting).
* $\tau$ is the tortuosity of the 3D matrix.

The penetration distance over time $t$ is then calculated as $d(t) = \sqrt{C \cdot t}$.

### 4. The Biphasic Release Profile (`simulateRelease`)

This is the core of the dissolution study. The code calculates total drug release by summing two distinct mechanisms: a rapid first-order burst release, and a sustained polymer-relaxation release.

**A. First-Order Burst Release**
Surface-level drug dissolves immediately upon hydration. This is modeled as an exponential decay function dependent on an effective burst rate constant ($k_{\text{eff}}$):


$$F{\text{burst}}(t) = F{\text{max\_burst}} \cdot (1 - e^{-k{\text{eff}} \cdot t})$$

**B. Sustained Release (Korsmeyer-Peppas Model)**
For the drug embedded deeper in the polymer matrix, the code utilizes the standard Korsmeyer-Peppas equation:


$$F{\text{KP}}(t) = k{\text{KP}} \cdot t^n$$

* $k_{\text{KP}}$ is a kinetic constant influenced by plasticizers (glycerol), surfactants (micelle boost), geometry, and the superdisintegrant.
* $n$ is the diffusional exponent governing the release mechanism (e.g., Fickian diffusion vs. polymer swelling). The code dynamically shifts this $n$ value based on the drug's molecular weight, HPMC concentration, and the physical geometry (planar vs. TPMS).

**C. The 60% Splice**
Because the Korsmeyer-Peppas model is physically only valid for the first **60%** of drug release, the code implements a mathematical "splice".
Once $F_{\text{KP}}(t)$ hits **0.6** (60%), the code calculates the remaining time ($t_{60}$) and switches to a late-stage exponential decay model ($1 - 0.4 \cdot e^{-\lambda \cdot \Delta t}$) to smoothly tail off the release profile to 100%.

**Total Fractional Release**
Finally, the absolute fractions are combined to plot the curves you see in the Recharts visualization:


$$F{\text{total}} = F{\text{burst}} + (1 - F{\text{max\_burst}}) \cdot F{\text{sustained}}$$


### 5. Surface Area, Volume, and Mass (`geometryModel`)

The shape of a microneedle drastically changes its surface area-to-volume ratio, which directly impacts how fast the coating dissolves.

**A. Surface Area (SA) Calculation**
The code calculates the precise surface area (in µm²) based on the selected shape (`geoKey`). It assumes the tip of the needle isn't perfectly sharp, giving it a tiny flat tip radius ($r_t = 5$).

* **Planar (Flat):** Standard circle area.

$$SA = \pi \cdot R^2$$


* **Conical & TPMS:** Modeled as a conical frustum (a cone with the top cut off). $sl$ is the slant length.

$$sl = \sqrt{H^2 + (R - r_t)^2}$$


$$SA = \pi \cdot (R + r_t) \cdot sl \cdot \text{saFactor}$$


* **Pyramidal:** Four triangular faces.

$$SA = 4 \cdot \left(\frac{1}{2} \cdot 2R \cdot \sqrt{H^2 + R^2}\right)$$



**B. Non-Uniform Coating Volume**
Usually, Volume = Surface Area × Thickness. However, for porous TPMS structures or stars, the coating doesn't dry perfectly evenly; it pools in the concave crevices. The code accounts for this with a `volumeFactor`:

* For TPMS: $\text{Factor} = 1.0 + 0.4 \cdot \text{porosity}$
* For Stars (which thin at the edges): $\text{Factor} = 0.92$

**C. Converting Volume to Mass**
Once the true volume of the coating ($\mu \text{m}^3$) is found, it is converted to mass ($\mu \text{g}$) using an assumed standard polymer density of 1.2 g/cm³ (which mathematically converts to $1.2 \times 10^{-6} \text{ \mu g/\mu m}^3$):


$$M_{\text{coat}} = \text{Volume}_{\mu \text{m}^3} \times 1.2 \times 10^{-6}$$


The actual drug mass is simply a fraction of this total coating mass:


$$M_{\text{drug}} = M_{\text{coat}} \times \text{drugLoadFrac}$$

### 6. The 3D Rendering Math (`TPMS_FNS`)

The code includes a 3D visualizer using Three.js. To generate the complex, porous, sponge-like TPMS (Triply Periodic Minimal Surfaces) structures, it doesn't use standard 3D meshes. Instead, it uses **implicit mathematical functions** where the surface exists exactly where the equation equals zero.

The code sweeps through an X, Y, Z grid and plots points wherever the absolute value of these equations is close to zero (e.g., $< 0.25$):

* **Gyroid:** 
$$\sin(x)\cos(y) + \sin(y)\cos(z) + \sin(z)\cos(x) = 0$$


* **Primitive (Schwarz P):** 
$$\cos(x) + \cos(y) + \cos(z) = 0$$


* **Diamond (Schwarz D):** 
$$\sin(x)\sin(y)\sin(z) + \sin(x)\cos(y)\cos(z) + \cos(x)\sin(y)\cos(z) + \cos(x)\cos(y)\sin(z) = 0$$



### 7. The Optimization Logic (`callAI`)

While not a hardcoded physics equation, the final "calculation" step is an API call. The code bundles up all the calculated metrics (Viscosity, Surface Tension, Peppas $n$ value, T80 release time, etc.) and sends them to an AI model (Claude). It essentially asks the AI to act as a solver to find the optimal concentration of superdisintegrant, glycerol, and Tween 80 to achieve the user's selected goal (e.g., "Fastest release").

