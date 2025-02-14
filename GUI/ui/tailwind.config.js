const WHITE = '#FFFFFF';
const BLACK = '#0D0C08';
const PIXELS = {
	'0px': '0px',
	'4px': '4px',
	'8px': '8px',
	'10px': '10px',
	'12px': '12px',
	'16px': '16px',
	'24px': '24px',
	'32px': '32px',
	'40px': '40px',
	'42px': '42px',
	'48px': '48px',
	'56px': '56px',
	'64px': '64px',
	'72px': '72px',
	'80px': '80px',
	'86px': '86px',
	'90px': '90px',
	'120px': '120px',
	'160px': '160px',
	'200px': '200px',
	'240px': '240px',
	'320px': '320px',
	'360px': '360px',
	'640px': '640px',
};
const SCREENS = {
	'100vh': '100vh',
	'100ah': 'calc(100vh - 64px)',
	'50ah': 'calc(50vh - 64px)',
	'95ah': 'calc(95vh - 64px)',
	'90ah': 'calc(90vh - 64px)',
	'1440px': '1440px',
	'full': '100%'
};
const AUTO = {
	auto: 'auto',
};
const FIT = {
	fit: 'fit-content',
};

/** @type {import('tailwindcss').Config} */
export default {
	content: ['./src/**/*.{html,js,svelte,ts}'],
	theme: {
		colors: {
			transparent: 'transparent',
			white: {
				100: WHITE,
				DEFAULT: WHITE
			},
			blue: {
				100: WHITE,
				200: '#EBFEFF',
				300: '#CEF0F2',
				500: '#00D4EE',
				700: '#2ABBF1',
				800: '#1C7CA0',
				900: BLACK
			},
			green: {
				100: WHITE,
				200: '#EEFFCF',
				300: '#C5FF5B',
				500: '#40C978',
				700: '#329F5F',
				800: '#216F41',
				900: BLACK
			},
			greenGrey: {
				100: WHITE,
				500: '#99D0B0',
				800: '#2F3834',
				900: BLACK
			},
			black: {
				100: WHITE,
				200: '#FEFEFE',
				300: '#F3F3F3',
				400: '#BDBDBD',
				500: '#878787',
				700: '#484A51',
				800: '#191A1D',
				900: BLACK,
				1000: '#000000'
			},
			purple: {
				800: '#5E01BC',
			},
			gradient: {
				tell0: '#CE006F',
				tell1: '#5E00BB',
				gray0: 'rgba(47, 56, 52, 0.50)',
				gray1: 'rgba(25, 26, 29, 0.50)',
				bar0: '#40C978',
				bar1: '#C5FF5B',
				panelFrom: 'rgba(0, 0, 0, 0.40)',
				panelTo: 'rgba(0, 0, 0, 0.12)',
				cardFrom: 'rgba(0, 0, 0, 0.32)',
				cardTo: 'rgba(0, 0, 0, 0)',
			}
		},
		borderRadius: {
			full: '9999px',
			'8px': '8px',
			'16px': '16px',
			'18px': '18px',
		},
		padding: PIXELS,
		margin: {...PIXELS, ...AUTO,
			'1em': '1em',
		},
		gap: PIXELS,
		spacing: {...PIXELS,
			'0': '0'
		},
		height: {...PIXELS, ...SCREENS, ...AUTO, ...FIT},
		width: {...PIXELS, ...SCREENS, ...AUTO, ...FIT},
		fontFamily: {
			sans: ['Poppins', 'sans-serif'],
			serif: ['Vollkorn', 'serif'],
			monospace: ['monospace'],
		},
		fontSize: {
			xsmall: '10px',
			small: '12px',
			normal: '14px',
			medium: '16px',
			large: '20px',
			'2l': '24px',
			'28px': '28px',
			'xl': '32px',
			'38px': '38px',
			'2xl': '40px',
			'3xl': '60px',
		},
		lineHeight: {
			normal: '10px',
			'14px': '14px',
			'24px': '24px',
			'28px': '28px',
			'32px': '32px',
			'2l': '28px',
			'xl': '40px',
			'2xl': '48px',
			'3xl': '68px',
		},
		extend: {
			transitionProperty: {
				'spacing': 'margin, padding'
			},
			screens: {
				'3xl': '2000px',
			}
		},
	},
	plugins: [],
}

