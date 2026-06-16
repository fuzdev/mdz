import {test, assert, describe} from 'vitest';

import type {MdzNode, MdzNodeComponent, MdzNodeElement} from '$lib/mdz.ts';
import {
	is_letter,
	is_tag_name_char,
	is_word_char,
	is_valid_path_char,
	mdz_trim_url_punctuation,
	is_at_absolute_path,
	is_at_relative_path,
	mdz_text_content,
	mdz_heading_id,
	mdz_is_url,
	mdz_is_safe_reference,
	mdz_is_void_element,
	match_url_prefix_case_insensitive,
	ascii_to_lower,
	mdz_resolve_relative_path,
	mdz_extract_single_tag,
	ASTERISK,
	UNDERSCORE,
	TILDE,
	A_UPPER,
	Z_UPPER,
	A_LOWER,
	Z_LOWER,
	ZERO,
	NINE,
	HYPHEN,
	SPACE,
	LEFT_BRACKET,
	RIGHT_BRACKET,
	LEFT_PAREN,
} from '$lib/mdz_helpers.ts';

/* eslint-disable no-script-url */

// helper to create nodes with dummy positions
const text = (content: string): MdzNode => ({type: 'Text', content, start: 0, end: 0});
const bold = (children: Array<MdzNode>): MdzNode => ({type: 'Bold', children, start: 0, end: 0});
const italic = (children: Array<MdzNode>): MdzNode => ({
	type: 'Italic',
	children,
	start: 0,
	end: 0,
});
const code = (content: string): MdzNode => ({type: 'Code', content, start: 0, end: 0});
const link = (reference: string, children: Array<MdzNode>): MdzNode => ({
	type: 'Link',
	reference,
	children,
	link_type: 'external',
	start: 0,
	end: 0,
});
const component = (name: string, children: Array<MdzNode>): MdzNodeComponent => ({
	type: 'Component',
	name,
	children,
	start: 0,
	end: 0,
});
const element = (name: string, children: Array<MdzNode>): MdzNodeElement => ({
	type: 'Element',
	name,
	children,
	start: 0,
	end: 0,
});

describe('is_letter', () => {
	test('returns true for uppercase letters', () => {
		assert.equal(is_letter(A_UPPER), true); // A
		assert.equal(is_letter(Z_UPPER), true); // Z
		assert.equal(is_letter(77), true); // M
	});

	test('returns true for lowercase letters', () => {
		assert.equal(is_letter(A_LOWER), true); // a
		assert.equal(is_letter(Z_LOWER), true); // z
		assert.equal(is_letter(109), true); // m
	});

	test('returns false for digits', () => {
		assert.equal(is_letter(ZERO), false);
		assert.equal(is_letter(NINE), false);
	});

	test('returns false for boundary characters just outside letter ranges', () => {
		assert.equal(is_letter(A_UPPER - 1), false); // @
		assert.equal(is_letter(Z_UPPER + 1), false); // [
		assert.equal(is_letter(A_LOWER - 1), false); // `
		assert.equal(is_letter(Z_LOWER + 1), false); // {
	});

	test('returns false for symbols', () => {
		assert.equal(is_letter(SPACE), false);
		assert.equal(is_letter(HYPHEN), false);
		assert.equal(is_letter(UNDERSCORE), false);
	});
});

describe('is_tag_name_char', () => {
	test('allows letters', () => {
		assert.equal(is_tag_name_char(A_UPPER), true);
		assert.equal(is_tag_name_char(A_LOWER), true);
	});

	test('allows digits', () => {
		assert.equal(is_tag_name_char(ZERO), true);
		assert.equal(is_tag_name_char(NINE), true);
	});

	test('allows hyphen and underscore', () => {
		assert.equal(is_tag_name_char(HYPHEN), true);
		assert.equal(is_tag_name_char(UNDERSCORE), true);
	});

	test('rejects other symbols', () => {
		assert.equal(is_tag_name_char(SPACE), false);
		assert.equal(is_tag_name_char(ASTERISK), false);
		assert.equal(is_tag_name_char(LEFT_BRACKET), false);
		assert.equal(is_tag_name_char(RIGHT_BRACKET), false);
	});
});

describe('is_word_char', () => {
	test('alphanumeric characters are word chars', () => {
		assert.equal(is_word_char(A_UPPER), true);
		assert.equal(is_word_char(Z_LOWER), true);
		assert.equal(is_word_char(ZERO), true);
		assert.equal(is_word_char(NINE), true);
	});

	test('formatting delimiters are NOT word chars', () => {
		assert.equal(is_word_char(ASTERISK), false);
		assert.equal(is_word_char(UNDERSCORE), false);
		assert.equal(is_word_char(TILDE), false);
	});

	test('other symbols are not word chars', () => {
		assert.equal(is_word_char(SPACE), false);
		assert.equal(is_word_char(HYPHEN), false);
		assert.equal(is_word_char(LEFT_PAREN), false);
	});
});

describe('is_valid_path_char', () => {
	test('allows unreserved characters', () => {
		assert.equal(is_valid_path_char(A_LOWER), true);
		assert.equal(is_valid_path_char(ZERO), true);
		assert.equal(is_valid_path_char(HYPHEN), true);
		assert.equal(is_valid_path_char('.'.charCodeAt(0)), true);
		assert.equal(is_valid_path_char(UNDERSCORE), true);
		assert.equal(is_valid_path_char(TILDE), true);
	});

	test('allows sub-delimiters', () => {
		assert.equal(is_valid_path_char('!'.charCodeAt(0)), true);
		assert.equal(is_valid_path_char('$'.charCodeAt(0)), true);
		assert.equal(is_valid_path_char('&'.charCodeAt(0)), true);
		assert.equal(is_valid_path_char('+'.charCodeAt(0)), true);
		assert.equal(is_valid_path_char('='.charCodeAt(0)), true);
	});

	test('allows path separators and query/fragment', () => {
		assert.equal(is_valid_path_char('/'.charCodeAt(0)), true);
		assert.equal(is_valid_path_char('?'.charCodeAt(0)), true);
		assert.equal(is_valid_path_char('#'.charCodeAt(0)), true);
		assert.equal(is_valid_path_char('%'.charCodeAt(0)), true);
	});

	test('allows parentheses (valid in URI path components)', () => {
		assert.equal(is_valid_path_char(LEFT_PAREN), true);
		assert.equal(is_valid_path_char(')'.charCodeAt(0)), true);
	});

	test('rejects spaces and brackets', () => {
		assert.equal(is_valid_path_char(SPACE), false);
		assert.equal(is_valid_path_char(LEFT_BRACKET), false);
		assert.equal(is_valid_path_char(RIGHT_BRACKET), false);
		assert.equal(is_valid_path_char('{'.charCodeAt(0)), false);
		assert.equal(is_valid_path_char('}'.charCodeAt(0)), false);
	});
});

describe('mdz_trim_url_punctuation', () => {
	test('trims simple trailing punctuation', () => {
		assert.equal(mdz_trim_url_punctuation('https://fuz.dev.'), 'https://fuz.dev');
		assert.equal(mdz_trim_url_punctuation('https://fuz.dev,'), 'https://fuz.dev');
		assert.equal(mdz_trim_url_punctuation('https://fuz.dev;'), 'https://fuz.dev');
		assert.equal(mdz_trim_url_punctuation('https://fuz.dev:'), 'https://fuz.dev');
		assert.equal(mdz_trim_url_punctuation('https://fuz.dev!'), 'https://fuz.dev');
		assert.equal(mdz_trim_url_punctuation('https://fuz.dev?'), 'https://fuz.dev');
		assert.equal(mdz_trim_url_punctuation('https://fuz.dev]'), 'https://fuz.dev');
	});

	test('trims multiple trailing punctuation chars', () => {
		assert.equal(mdz_trim_url_punctuation('https://fuz.dev..'), 'https://fuz.dev');
		assert.equal(mdz_trim_url_punctuation('https://fuz.dev!?'), 'https://fuz.dev');
	});

	test('returns original string reference when no trimming needed', () => {
		const url = 'https://fuz.dev/path';
		const result = mdz_trim_url_punctuation(url);
		assert.ok(result === url, 'should return same string reference');
	});

	test('handles balanced parentheses (Wikipedia-style URLs)', () => {
		assert.equal(
			mdz_trim_url_punctuation('https://en.wikipedia.org/wiki/Foo_(bar)'),
			'https://en.wikipedia.org/wiki/Foo_(bar)',
		);
	});

	test('trims unmatched trailing closing parens', () => {
		assert.equal(mdz_trim_url_punctuation('https://fuz.dev)'), 'https://fuz.dev');
		assert.equal(mdz_trim_url_punctuation('https://fuz.dev))'), 'https://fuz.dev');
	});

	test('keeps matched parens but trims excess', () => {
		assert.equal(mdz_trim_url_punctuation('https://fuz.dev/(foo))'), 'https://fuz.dev/(foo)');
	});

	test('handles empty string', () => {
		assert.equal(mdz_trim_url_punctuation(''), '');
	});

	test('trims string that is all punctuation', () => {
		assert.equal(mdz_trim_url_punctuation('.,;:!?'), '');
	});

	test('keeps multiple balanced paren pairs', () => {
		assert.equal(mdz_trim_url_punctuation('https://fuz.dev/(a)(b)'), 'https://fuz.dev/(a)(b)');
	});

	test('keeps nested balanced parens', () => {
		assert.equal(
			mdz_trim_url_punctuation('https://en.wikipedia.org/wiki/Foo_(bar_(baz))'),
			'https://en.wikipedia.org/wiki/Foo_(bar_(baz))',
		);
	});

	test('trims punctuation after parens', () => {
		assert.equal(mdz_trim_url_punctuation('https://fuz.dev/(foo).'), 'https://fuz.dev/(foo)');
	});
});

describe('is_at_absolute_path', () => {
	test('detects path at start of string', () => {
		assert.equal(is_at_absolute_path('/foo/bar', 0), true);
	});

	test('detects path after space', () => {
		assert.equal(is_at_absolute_path('see /foo/bar', 4), true);
	});

	test('detects path after newline', () => {
		assert.equal(is_at_absolute_path('see\n/foo', 4), true);
	});

	test('detects path after tab', () => {
		assert.equal(is_at_absolute_path('see\t/foo', 4), true);
	});

	test('rejects double slash (protocol-relative or comment)', () => {
		assert.equal(is_at_absolute_path('//foo', 0), false);
	});

	test('rejects slash followed by space', () => {
		assert.equal(is_at_absolute_path('/ foo', 0), false);
	});

	test('rejects slash followed by newline', () => {
		assert.equal(is_at_absolute_path('/\n', 0), false);
	});

	test('rejects slash followed by tab', () => {
		assert.equal(is_at_absolute_path('/\tfoo', 0), false);
	});

	test('rejects slash at end of string', () => {
		assert.equal(is_at_absolute_path('/', 0), false);
	});

	test('rejects slash not preceded by whitespace', () => {
		assert.equal(is_at_absolute_path('x/foo', 1), false);
	});

	test('rejects non-slash character', () => {
		assert.equal(is_at_absolute_path('foo', 0), false);
	});
});

describe('is_at_relative_path', () => {
	test('detects ./ path at start of string', () => {
		assert.equal(is_at_relative_path('./foo', 0), true);
	});

	test('detects ../ path at start of string', () => {
		assert.equal(is_at_relative_path('../foo', 0), true);
	});

	test('detects ./ path after space', () => {
		assert.equal(is_at_relative_path('see ./foo', 4), true);
	});

	test('detects ../ path after newline', () => {
		assert.equal(is_at_relative_path('see\n../foo', 4), true);
	});

	test('detects ./ path after tab', () => {
		assert.equal(is_at_relative_path('see\t./foo', 4), true);
	});

	test('rejects ./ without following path char', () => {
		assert.equal(is_at_relative_path('./', 0), false);
	});

	test('rejects ../ without following path char', () => {
		assert.equal(is_at_relative_path('../', 0), false);
	});

	test('rejects ../ at end of string', () => {
		assert.equal(is_at_relative_path('see ../', 4), false);
	});

	test('rejects ./ followed by space', () => {
		assert.equal(is_at_relative_path('./ foo', 0), false);
	});

	test('rejects ./ followed by slash', () => {
		assert.equal(is_at_relative_path('.//foo', 0), false);
	});

	test('rejects ../ followed by slash', () => {
		assert.equal(is_at_relative_path('..//', 0), false);
	});

	test('rejects ../ followed by space', () => {
		assert.equal(is_at_relative_path('../ foo', 0), false);
	});

	test('rejects ../ followed by newline', () => {
		assert.equal(is_at_relative_path('../\n', 0), false);
	});

	test('rejects ../ followed by tab', () => {
		assert.equal(is_at_relative_path('../\tfoo', 0), false);
	});

	test('rejects period not preceded by whitespace', () => {
		assert.equal(is_at_relative_path('x./foo', 1), false);
	});

	test('rejects bare period', () => {
		assert.equal(is_at_relative_path('.', 0), false);
	});

	test('rejects ./ followed by newline', () => {
		assert.equal(is_at_relative_path('./\n', 0), false);
	});

	test('rejects ./ followed by tab', () => {
		assert.equal(is_at_relative_path('./\tfoo', 0), false);
	});

	test('rejects non-period character', () => {
		assert.equal(is_at_relative_path('foo', 0), false);
	});
});

describe('mdz_text_content', () => {
	test('extracts text from text nodes', () => {
		assert.equal(mdz_text_content([text('hello')]), 'hello');
	});

	test('concatenates multiple text nodes', () => {
		assert.equal(mdz_text_content([text('hello'), text(' world')]), 'hello world');
	});

	test('recurses into children (bold)', () => {
		assert.equal(mdz_text_content([bold([text('bold text')])]), 'bold text');
	});

	test('recurses into nested formatting', () => {
		assert.equal(
			mdz_text_content([bold([text('bold '), italic([text('and italic')])])]),
			'bold and italic',
		);
	});

	test('extracts content from code nodes', () => {
		assert.equal(mdz_text_content([text('see '), code('foo'), text(' here')]), 'see foo here');
	});

	test('returns empty string for empty array', () => {
		assert.equal(mdz_text_content([]), '');
	});

	test('returns empty string for nodes without content or children', () => {
		const hr: MdzNode = {type: 'Hr', start: 0, end: 0};
		assert.equal(mdz_text_content([hr]), '');
	});

	test('recurses into Link children, not reference', () => {
		assert.equal(mdz_text_content([link('https://fuz.dev', [text('click here')])]), 'click here');
	});

	test('skips Hr nodes interspersed with text', () => {
		const hr: MdzNode = {type: 'Hr', start: 0, end: 0};
		assert.equal(mdz_text_content([text('before'), hr, text('after')]), 'beforeafter');
	});
});

describe('mdz_heading_id', () => {
	test('generates slug from plain text', () => {
		assert.equal(mdz_heading_id([text('Hello World')]), 'hello-world');
	});

	test('lowercases the slug', () => {
		assert.equal(mdz_heading_id([text('UPPERCASE')]), 'uppercase');
	});

	test('strips formatting and uses text content', () => {
		assert.equal(mdz_heading_id([bold([text('Bold')]), text(' text')]), 'bold-text');
	});

	test('handles code in headings', () => {
		assert.equal(
			mdz_heading_id([text('The '), code('foo'), text(' function')]),
			'the-foo-function',
		);
	});
});

describe('mdz_is_url', () => {
	test('returns true for valid URLs', () => {
		assert.equal(mdz_is_url('https://fuz.dev'), true);
		assert.equal(mdz_is_url('https://a'), true);
		assert.equal(mdz_is_url('http://fuz.dev'), true);
		assert.equal(mdz_is_url('http://a'), true);
		assert.equal(mdz_is_url('https://fuz.dev/path?query=1#hash'), true);
	});

	test('returns true for IPv6 URLs', () => {
		assert.equal(mdz_is_url('https://[::1]'), true);
		assert.equal(mdz_is_url('https://[2001:db8::1]:8080/path'), true);
		assert.equal(mdz_is_url('http://[::1]/'), true);
	});

	test('returns true for internationalized domain names', () => {
		assert.equal(mdz_is_url('https://例え.jp'), true);
		assert.equal(mdz_is_url('https://münchen.de'), true);
		assert.equal(mdz_is_url('https://пример.рф'), true);
	});

	test('returns false for bare protocols', () => {
		assert.equal(mdz_is_url('https://'), false);
		assert.equal(mdz_is_url('http://'), false);
	});

	test('returns false for protocols followed by whitespace', () => {
		assert.equal(mdz_is_url('https:// '), false);
		assert.equal(mdz_is_url('https://\n'), false);
		assert.equal(mdz_is_url('https://\t'), false);
		assert.equal(mdz_is_url('http:// '), false);
		assert.equal(mdz_is_url('http://\n'), false);
	});

	test('returns false for protocols followed by invalid start chars', () => {
		assert.equal(mdz_is_url('https://)'), false);
		assert.equal(mdz_is_url('https://]'), false);
		assert.equal(mdz_is_url('https://}'), false);
		assert.equal(mdz_is_url('https://<'), false);
		assert.equal(mdz_is_url('https://>'), false);
		assert.equal(mdz_is_url('https://.'), false);
		assert.equal(mdz_is_url('https://,'), false);
		assert.equal(mdz_is_url('https://:'), false);
		assert.equal(mdz_is_url('https:///'), false);
		assert.equal(mdz_is_url('https://?'), false);
		assert.equal(mdz_is_url('https://#'), false);
		assert.equal(mdz_is_url('https://!'), false);
		assert.equal(mdz_is_url('http://)foo'), false);
		assert.equal(mdz_is_url('https://.com'), false);
	});

	test('returns false for non-URLs', () => {
		assert.equal(mdz_is_url(''), false);
		assert.equal(mdz_is_url('fuz.dev'), false);
		assert.equal(mdz_is_url('/path'), false);
		assert.equal(mdz_is_url('ftp://fuz.dev'), false);
	});

	test('scheme match is case-insensitive (RFC 3986)', () => {
		assert.equal(mdz_is_url('HTTPS://fuz.dev'), true);
		assert.equal(mdz_is_url('Https://fuz.dev'), true);
		assert.equal(mdz_is_url('HtTpS://fuz.dev'), true);
		assert.equal(mdz_is_url('HTTP://fuz.dev'), true);
		assert.equal(mdz_is_url('Http://fuz.dev'), true);
		assert.equal(mdz_is_url('HTTPS://'), false);
		assert.equal(mdz_is_url('HTTP://'), false);
	});
});

describe('match_url_prefix_case_insensitive', () => {
	test('returns 8 for lowercase https://', () => {
		assert.equal(match_url_prefix_case_insensitive('https://fuz.dev', 0), 8);
	});

	test('returns 7 for lowercase http://', () => {
		assert.equal(match_url_prefix_case_insensitive('http://fuz.dev', 0), 7);
	});

	test('matches HTTPS:// case-insensitively', () => {
		assert.equal(match_url_prefix_case_insensitive('HTTPS://fuz.dev', 0), 8);
		assert.equal(match_url_prefix_case_insensitive('Https://fuz.dev', 0), 8);
		assert.equal(match_url_prefix_case_insensitive('HtTpS://fuz.dev', 0), 8);
	});

	test('matches HTTP:// case-insensitively', () => {
		assert.equal(match_url_prefix_case_insensitive('HTTP://fuz.dev', 0), 7);
		assert.equal(match_url_prefix_case_insensitive('Http://fuz.dev', 0), 7);
	});

	test('returns 0 for non-http(s) schemes', () => {
		assert.equal(match_url_prefix_case_insensitive('ftp://fuz.dev', 0), 0);
		assert.equal(match_url_prefix_case_insensitive('javascript:alert(1)', 0), 0);
		assert.equal(match_url_prefix_case_insensitive('mailto:a@b.c', 0), 0);
	});

	test('returns 0 when too short', () => {
		assert.equal(match_url_prefix_case_insensitive('http:/', 0), 0);
		assert.equal(match_url_prefix_case_insensitive('h', 0), 0);
		assert.equal(match_url_prefix_case_insensitive('', 0), 0);
	});

	test('honors pos offset', () => {
		assert.equal(match_url_prefix_case_insensitive('see HTTPS://fuz.dev', 4), 8);
		assert.equal(match_url_prefix_case_insensitive('xx Http://fuz.dev', 3), 7);
		assert.equal(match_url_prefix_case_insensitive('Https://fuz.dev', 1), 0);
	});

	test('colon and slashes are literal (only scheme letters case-fold)', () => {
		assert.equal(match_url_prefix_case_insensitive('https//fuz.dev', 0), 0);
		assert.equal(match_url_prefix_case_insensitive('https:/fuz.dev', 0), 0);
	});

	test('rejects schemes with wrong letters or layout', () => {
		// wrong letters in scheme
		assert.equal(match_url_prefix_case_insensitive('Httpz://x', 0), 0);
		assert.equal(match_url_prefix_case_insensitive('ottps://x', 0), 0);
		assert.equal(match_url_prefix_case_insensitive('hxtps://x', 0), 0);
		// embedded whitespace or other chars in scheme
		assert.equal(match_url_prefix_case_insensitive('Htt p://x', 0), 0);
		assert.equal(match_url_prefix_case_insensitive('h_ttps://x', 0), 0);
		// backslashes are not forward slashes
		assert.equal(match_url_prefix_case_insensitive('https:\\\\path', 0), 0);
		// uppercase H followed by non-scheme letters
		assert.equal(match_url_prefix_case_insensitive('Hello://world', 0), 0);
	});
});

describe('ascii_to_lower', () => {
	test('lowercases ASCII upper-case letters', () => {
		assert.equal(ascii_to_lower(65 /* A */), 97 /* a */);
		assert.equal(ascii_to_lower(72 /* H */), 104 /* h */);
		assert.equal(ascii_to_lower(90 /* Z */), 122 /* z */);
	});

	test('passes through non-uppercase chars unchanged', () => {
		assert.equal(ascii_to_lower(97 /* a */), 97);
		assert.equal(ascii_to_lower(48 /* 0 */), 48);
		assert.equal(ascii_to_lower(32 /* space */), 32);
		assert.equal(ascii_to_lower(91 /* [ */), 91);
		assert.equal(ascii_to_lower(0xc4 /* Ä, non-ASCII */), 0xc4);
	});
});

describe('mdz_is_safe_reference', () => {
	test('allows empty string', () => {
		assert.equal(mdz_is_safe_reference(''), true);
	});

	test('allows paths without colons', () => {
		assert.equal(mdz_is_safe_reference('/path'), true);
		assert.equal(mdz_is_safe_reference('/path/to/page'), true);
		assert.equal(mdz_is_safe_reference('./relative'), true);
		assert.equal(mdz_is_safe_reference('../parent'), true);
		assert.equal(mdz_is_safe_reference('#hash'), true);
		assert.equal(mdz_is_safe_reference('?query=1'), true);
		assert.equal(mdz_is_safe_reference('docs/page'), true);
		assert.equal(mdz_is_safe_reference('foo'), true);
	});

	test('allows http and https URLs', () => {
		assert.equal(mdz_is_safe_reference('https://fuz.dev'), true);
		assert.equal(mdz_is_safe_reference('http://fuz.dev'), true);
		assert.equal(mdz_is_safe_reference('HTTPS://EXAMPLE.COM'), true);
		assert.equal(mdz_is_safe_reference('Http://Example.Com'), true);
		assert.equal(mdz_is_safe_reference('https://fuz.dev/path?q=1#h'), true);
	});

	test('rejects javascript protocol', () => {
		assert.equal(mdz_is_safe_reference('javascript:alert(1)'), false);
		assert.equal(mdz_is_safe_reference('JavaScript:alert(1)'), false);
		assert.equal(mdz_is_safe_reference('JAVASCRIPT:ALERT(1)'), false);
	});

	test('rejects data protocol', () => {
		assert.equal(mdz_is_safe_reference('data:text/html,<script>alert(1)</script>'), false);
		assert.equal(mdz_is_safe_reference('Data:text/html,test'), false);
	});

	test('rejects vbscript protocol', () => {
		assert.equal(mdz_is_safe_reference('vbscript:msgbox'), false);
		assert.equal(mdz_is_safe_reference('VBScript:MsgBox'), false);
	});

	test('rejects other protocols with colons', () => {
		assert.equal(mdz_is_safe_reference('ftp://fuz.dev'), false);
		assert.equal(mdz_is_safe_reference('file:///etc/passwd'), false);
		assert.equal(mdz_is_safe_reference('blob:http://fuz.dev/uuid'), false);
		assert.equal(mdz_is_safe_reference('mailto:user@fuz.dev'), false);
	});
});

describe('mdz_is_void_element', () => {
	test('matches the HTML void elements', () => {
		assert.equal(mdz_is_void_element('br'), true);
		assert.equal(mdz_is_void_element('hr'), true);
		assert.equal(mdz_is_void_element('img'), true);
		assert.equal(mdz_is_void_element('input'), true);
		assert.equal(mdz_is_void_element('wbr'), true);
	});

	test('rejects non-void elements', () => {
		assert.equal(mdz_is_void_element('div'), false);
		assert.equal(mdz_is_void_element('aside'), false);
		assert.equal(mdz_is_void_element('p'), false);
		assert.equal(mdz_is_void_element(''), false);
	});

	test('is case-sensitive — mdz tag names are lowercase', () => {
		assert.equal(mdz_is_void_element('BR'), false);
		assert.equal(mdz_is_void_element('Br'), false);
	});
});

describe('mdz_resolve_relative_path', () => {
	test('resolves ./ path', () => {
		assert.equal(mdz_resolve_relative_path('./bar', '/docs/foo/'), '/docs/foo/bar');
	});

	test('resolves ../ path', () => {
		assert.equal(mdz_resolve_relative_path('../foo', '/docs/foo/'), '/docs/foo');
	});

	test('resolves nested ./ path', () => {
		assert.equal(mdz_resolve_relative_path('./a/b/c', '/docs/foo/'), '/docs/foo/a/b/c');
	});

	test('resolves multiple ../ segments', () => {
		assert.equal(mdz_resolve_relative_path('../../baz', '/docs/foo/'), '/baz');
	});

	test('normalizes base without trailing slash', () => {
		assert.equal(mdz_resolve_relative_path('./bar', '/docs/foo'), '/docs/foo/bar');
	});

	test('normalizes base without trailing slash for ../', () => {
		assert.equal(mdz_resolve_relative_path('../baz', '/docs/foo'), '/docs/baz');
	});

	test('clamps at root', () => {
		assert.equal(mdz_resolve_relative_path('../../../foo', '/docs/'), '/foo');
	});

	test('handles embedded .. segments', () => {
		assert.equal(mdz_resolve_relative_path('./a/../b', '/docs/foo/'), '/docs/foo/b');
	});

	test('handles embedded . segments', () => {
		assert.equal(mdz_resolve_relative_path('./a/./b', '/docs/foo/'), '/docs/foo/a/b');
	});

	test('resolves to base directory for ../dirname', () => {
		assert.equal(mdz_resolve_relative_path('../foo', '/docs/foo/'), '/docs/foo');
	});

	test('handles root base', () => {
		assert.equal(mdz_resolve_relative_path('./foo', '/'), '/foo');
	});

	test('handles root base with ../ clamped', () => {
		assert.equal(mdz_resolve_relative_path('../foo', '/'), '/foo');
	});

	test('handles multiple embedded ..', () => {
		assert.equal(mdz_resolve_relative_path('./a/b/../../c', '/docs/foo/'), '/docs/foo/c');
	});

	test('preserves trailing slash in reference', () => {
		assert.equal(mdz_resolve_relative_path('./bar/', '/docs/foo/'), '/docs/foo/bar/');
	});

	test('handles deeply nested base', () => {
		assert.equal(mdz_resolve_relative_path('../bar', '/a/b/c/d/e/'), '/a/b/c/d/bar');
	});

	test('handles empty base', () => {
		assert.equal(mdz_resolve_relative_path('./foo', ''), '/foo');
	});

	test('skips internal double slashes', () => {
		assert.equal(mdz_resolve_relative_path('.//bar', '/docs/foo/'), '/docs/foo/bar');
	});
});

describe('mdz_extract_single_tag', () => {
	test('returns component node when it is the only node', () => {
		const comp = component('Alert', [text('warning')]);
		assert.equal(mdz_extract_single_tag([comp]), comp);
	});

	test('returns element node when it is the only node', () => {
		const el = element('div', [text('content')]);
		assert.equal(mdz_extract_single_tag([el]), el);
	});

	test('allows surrounding whitespace-only text nodes', () => {
		const comp = component('Alert', []);
		assert.equal(mdz_extract_single_tag([text('  '), comp, text('\n')]), comp);
	});

	test('returns null for multiple tags', () => {
		assert.equal(mdz_extract_single_tag([component('A', []), component('B', [])]), null);
	});

	test('returns null when non-whitespace text is present', () => {
		assert.equal(mdz_extract_single_tag([text('hello'), component('Alert', [])]), null);
	});

	test('returns null for non-tag node types', () => {
		assert.equal(mdz_extract_single_tag([bold([text('bold')])]), null);
	});

	test('returns null for code node (has content but is not a tag)', () => {
		assert.equal(mdz_extract_single_tag([code('foo')]), null);
	});

	test('returns null for Link node (has children but is not a tag)', () => {
		assert.equal(mdz_extract_single_tag([link('https://fuz.dev', [text('link')])]), null);
	});

	test('returns null for mixed component and element', () => {
		assert.equal(mdz_extract_single_tag([component('Alert', []), element('div', [])]), null);
	});

	test('returns null for empty array', () => {
		assert.equal(mdz_extract_single_tag([]), null);
	});

	test('returns null for only whitespace text nodes', () => {
		assert.equal(mdz_extract_single_tag([text('  '), text('\n')]), null);
	});
});
