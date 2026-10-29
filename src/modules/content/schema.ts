import { z } from 'zod';
const short = z.string().trim().max(180);
const copy = z.string().trim().max(1200);
const href = z
  .string()
  .max(300)
  .refine(
    (value) =>
      /^\/(?:shop|products|contact|help|policies|account)(?:[/?#]|$)/.test(
        value,
      ) &&
      !value.includes('\\') &&
      [...value].every((character) => character.charCodeAt(0) >= 32),
    'Use a storefront link such as /shop?category=home-living',
  );
const image = z
  .string()
  .regex(
    /^\/(?:api\/media\/[0-9a-f-]{36}|products\/(?:headphones|lamp)\.svg)$/,
  );
const heading = z
  .object({
    enabled: z.boolean(),
    eyebrow: short,
    title: short,
    buttonLabel: short,
    buttonHref: href,
  })
  .strict();
export const contentSchema = z
  .object({
    hero: z
      .object({
        enabled: z.boolean(),
        eyebrow: short,
        title: short,
        secondLine: short,
        highlight: short,
        description: copy,
        buttonLabel: short,
        buttonHref: href,
        imageUrl: image,
        imageAlt: short,
        footnote: short,
        labelEyebrow: short,
        labelTitle: short,
        cornerText: short,
        verticalNote: short,
      })
      .strict(),
    editorial: z
      .object({
        enabled: z.boolean(),
        eyebrow: short,
        title: copy,
        description: copy,
        buttonLabel: short,
        buttonHref: href,
        imageUrl: image,
        imageAlt: short,
        imageCaption: short,
      })
      .strict(),
    categories: heading,
    arrivals: heading,
    closing: heading.extend({ description: copy }).strict(),
    announcement: z
      .object({
        enabled: z.boolean(),
        text: short,
        buttonLabel: short,
        buttonHref: href,
      })
      .strict(),
    trust: z
      .object({
        enabled: z.boolean(),
        title1: short,
        text1: short,
        title2: short,
        text2: short,
        title3: short,
        text3: short,
      })
      .strict(),
    footer: z
      .object({
        description: copy,
        eyebrow: short,
        title: short,
        bottomText: short,
      })
      .strict(),
    faq: z
      .object({
        question1: short,
        answer1: copy,
        question2: short,
        answer2: copy,
        question3: short,
        answer3: copy,
      })
      .strict(),
  })
  .strict();
export const defaultContent: z.infer<typeof contentSchema> = {
  hero: {
    enabled: true,
    eyebrow: 'THE EVERYDAY, REIMAGINED',
    title: 'Good finds.',
    secondLine: 'Global',
    highlight: 'possibilities.',
    description:
      'From the things you need to the things you love.\nDiscover a world of thoughtful finds, all in one place.',
    buttonLabel: 'Find your next favorite',
    buttonHref: '/shop',
    imageUrl: '/products/headphones.svg',
    imageAlt: 'Sculptural sage green wireless headphones',
    footnote: 'Many categories. One great discovery.',
    labelEyebrow: 'A LITTLE EVERYDAY UPGRADE',
    labelTitle: 'Less noise. More you.',
    cornerText: 'SOUND GOOD.\nFEEL GOOD.',
    verticalNote: 'THE E-COM GLOBAL EDIT / 01',
  },
  editorial: {
    enabled: true,
    eyebrow: 'THE HOME & LIVING EDIT',
    title: 'A little comfort.\nA lot of character.',
    description:
      'Simple details that make your space feel a little more like you. Discover a new perspective on everyday living.',
    buttonLabel: 'Make yourself at home',
    buttonHref: '/shop?category=home-living',
    imageUrl: '/products/lamp.svg',
    imageAlt: 'Warm terracotta table lamp',
    imageCaption: 'MAKE ROOM FOR WHAT YOU LOVE.',
  },
  categories: {
    enabled: true,
    eyebrow: 'A GOOD PLACE TO START',
    title: 'Find your kind of everyday.',
    buttonLabel: 'Explore all categories',
    buttonHref: '/shop',
  },
  arrivals: {
    enabled: true,
    eyebrow: 'WORTH A CLOSER LOOK',
    title: 'Meet your next favorites.',
    buttonLabel: 'Shop the collection',
    buttonHref: '/shop',
  },
  closing: {
    enabled: true,
    eyebrow: 'YOUR EVERYDAY, WITHOUT LIMITS',
    title: 'Great finds are closer than you think.',
    description:
      'Explore something different. Find something that feels like you.',
    buttonLabel: 'Discover E-com Global',
    buttonHref: '/shop',
  },
  announcement: {
    enabled: true,
    text: 'A world of good finds. All in one place.',
    buttonLabel: 'Explore the collection',
    buttonHref: '/shop',
  },
  trust: {
    enabled: true,
    title1: 'A world of choice',
    text1: 'Eight currencies. Every category.',
    title2: 'Your account, protected',
    text2: 'Secure sign-in and checkout.',
    title3: 'Know before you order',
    text3: 'Clear totals. Upfront delivery rules.',
  },
  footer: {
    description:
      'Everyday essentials. Unexpected discoveries.\nA little more possibility, wherever you are.',
    eyebrow: 'BUILT FOR EVERYDAY DISCOVERY',
    title: 'One world.\nMore possibilities.',
    bottomText: 'Thoughtfully selected. Globally minded.',
  },
  faq: {
    question1: 'How can I track my order?',
    answer1:
      'Sign in and open My account → Orders & tracking. Your order shows its delivery estimate and the latest shipment updates from our team.',
    question2: 'How do I pay for my order?',
    answer2:
      'Checkout opens Paystack’s secure payment page. Your order updates after payment verification.',
    question3: 'How do I report a problem or ask about a return?',
    answer3:
      'Use Contact us and include your order reference and the item details. Our team will review your request and confirm the applicable policy.',
  },
};
