# walkSD

Live app: [https://bmarkman1234.github.io/walkSD/](https://bmarkman1234.github.io/walkSD/)


## How to Use

1. Open the app link above.
2. Use **Color By** to switch between:
   - Combined Score
   - Grocery/Convenience Count
   - Park Count
   - Library Count
3. Use **Layer Emphasis**:
   - left = emphasize community boundaries
   - right = emphasize hex visibility
4. Use **Click Mode**:
   - **Hex**: click a hex to see local values
   - **Community**: click a community plan to see aggregated stats

## What the Map Shows

- Hex-level walkability across San Diego
- Community plan boundaries
- Combined Score based on nearby services:
  - grocery/convenience +1 (within 800m)
  - parks +1 (within 800m)
  - libraries +1 (within 1200m)

## Local Run (optional)

From the repo:

```powershell
git clone https://github.com/bmarkman1234/walkSD.git
cd walkSD
```

```powershell
python -m http.server 8000
```

Then open `http://localhost:8000/`.
