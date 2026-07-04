# Testimonial photos

Drop portrait images here to show real faces on the landing testimonials.
Square images (400×400+) look best; they're masked into a circle.

Expected filenames (referenced from the `FACE_OVERRIDES` map and the
testimonials data in `src/resume-ai-preview.jsx`):

- `amira-hassan.jpg`    — Amira Hassan, lead candidate (Muslim woman, in hijab)
- `sarah-chen.jpg`      — Sarah Chen (Chinese woman)
- `nurul-aisyah.jpg`    — Nurul Aisyah (Malay woman, in hijab)
- `tan-wei-ming.jpg`    — Tan Wei Ming (Chinese-Malaysian man)

A named person's photo applies **everywhere** they appear (candidate lists,
previews, testimonials) via `FACE_OVERRIDES`. If a file is missing, the
avatar gracefully falls back to the person's initials in a circle. To add
more people or change filenames, edit `FACE_OVERRIDES` in
`src/resume-ai-preview.jsx`.
