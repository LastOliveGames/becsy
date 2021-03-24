export const config = {
  DEBUG: false
};

if (typeof process !== 'undefined') config.DEBUG = !!process.env.BECSY_DEBUG;
