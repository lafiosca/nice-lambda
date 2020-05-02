module.exports = {
	root: true,
	parser: '@typescript-eslint/parser',
	parserOptions: {
		project: './tsconfig.json',
	},
	plugins: ['@typescript-eslint'],
	extends: ['airbnb-typescript/base'],
	rules: {
		'no-tabs': 0,
		'arrow-body-style': 0,
		'arrow-parens': [2, 'always'],
		'no-console': 0,
		'max-len': [2, {
			code: 120,
			tabWidth: 4,
			ignoreComments: true,
			ignoreUrls: true,
			ignoreStrings: true,
			ignoreTemplateLiterals: true,
			ignoreRegExpLiterals: true,
		}],
		'@typescript-eslint/indent': [2, 'tab', { SwitchCase: 1 }],
		// 'import/no-unresolved': 0, // ts already provides errors for this and updates more quickly in VSCode
		// 'import/prefer-default-export': 0,
		// 'import/no-extraneous-dependencies': [2, { devDependencies: true }], // allows import of type def libs
	},
};
