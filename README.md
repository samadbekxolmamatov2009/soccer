# Dream League Soccer 2026 (brauzer + Android)

Three.js asosidagi 3D futbol o'yini.

## Qanday o'ynash mumkin

- **Laptop/kompyuter:** `index.html` faylini brauzerda oching. Hech narsa o'rnatish shart emas.
- **Telefon (sayt):** GitHub Pages'ni yoqing (Settings → Pages → `main`), havolani telefonda oching va brauzer menyusidan
  "Bosh ekranga qo'shish"ni tanlang. O'yin ilova kabi to'liq ekranda ochiladi va internetsiz ham ishlaydi.
- **Android ilova:** [`apk/DLS2026.apk`](apk/DLS2026.apk) faylini telefonga yuklab, o'rnating
  (sozlamalarda "noma'lum manbalardan o'rnatish"ga ruxsat bering).

## Boshqaruv

| Tugma | Klaviatura | Hujumda | Himoyada |
|---|---|---|---|
| Joystik | WASD / strelkalar | Yurish | Yurish |
| **A** | E (yoki J, Z) | Pas | O'yinchini almashtirish |
| **B** | Probel (yoki K, X) | Zarba (bosib turing = kuchliroq) | Sirpanib to'p olish |
| **C** | Shift (yoki L, C) | Sprint | Sprint |

P yoki Esc — pauza, Enter — o'yinni boshlash.

## APK'ni qayta yig'ish

Android SDK o'rnatilgan kompyuterda:

```bash
cd android
./gradlew assembleRelease
```

Tayyor fayl: `android/app/build/outputs/apk/release/app-release.apk`. O'yin fayllari (`index.html`, `game.js`, ...)
build paytida avtomatik APK ichiga ko'chiriladi.
