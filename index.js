var path = require('path');
var fs = require('fs');
var http = require('follow-redirects').http;
var https = require('follow-redirects').https;
var async = require('async');
var cheerio = require('cheerio');
var netscape = require('netscape-bookmarks');

var quiverPath = path.join(process.env['HOME'], '/Library/Containers/com.happenapps.Quiver/Data/Library/Application\ Support/Quiver');
var libraryPath = path.join(quiverPath, '/Quiver.qvlibrary');
var titleCachePath = path.join(quiverPath, '/quiver-bookmarks-titles.json');
var bookmarks = {};
var unresolvedLength = 0;

var EXT_NOTEBOOK = '.qvnotebook';
var EXT_NOTE = '.qvnote';
var ARG_PRUNE = '--prune';
var ARG_PRUNE_SHORT = '-p';
var ARG_RESOLVE = '--resolve';
var ARG_RESOLVE_SHORT = '-r';
var ARG_OUTPUT = '--out';
var ARG_OUTPUT_SHORT = '-o';
var ARG_HELP = '--help';
var ARG_HELP_SHORT = '-h';

// --prune to exclude notebooks and notes without bookmarks
function isPruning() {
	return process.argv.indexOf(ARG_PRUNE) !== -1 || process.argv.indexOf(ARG_PRUNE_SHORT) !== -1;
}

// --resolve to not resolve titles of the bookmarks from their webpages
function isResolving() {
	return process.argv.indexOf(ARG_RESOLVE) !== -1 || process.argv.indexOf(ARG_RESOLVE_SHORT) !== -1;
}

function getOutput() {
	var index = process.argv.indexOf(ARG_OUTPUT);
	if(index === -1)
		index = process.argv.indexOf(ARG_OUTPUT_SHORT);
	if(index !== -1)
		return process.argv[index + 1];
}

function isHttp(url) {
	url = url.substr(0, 8).toLowerCase();
	return !url.indexOf('http://') || !url.indexOf('https://');
}

function hasExt(filename, ext) {
	return filename.toLowerCase().indexOf(ext) === (filename.length - ext.length);
}

function processNote(notePath, group, cb) {
	var metaPath = path.join(notePath, 'meta.json');
	var contentPath = path.join(notePath, 'content.json');
	var meta = require(metaPath);
	var content = require(contentPath);
	var subgroup = group[meta.title] = {contents:{}};
	for(var i = 0; i < content.cells.length; ++i) {
		var cell = content.cells[i];
		if(cell.type === 'text') {
			var $ = cheerio.load(cell.data);
			$('a').each(function(idx, el) {
				var $el = $(el);
				var href = $el.attr('href');
				if(isHttp(href)) {
					var title = $el.text().trim();
					subgroup.contents[title] = href;
				}
			});
		}
	}
	if(isPruning() && !Object.keys(subgroup.contents).length)
		delete group[meta.title];
	cb();
}

function processNotebook(notebookPath, cb) {
	var metaPath = path.join(notebookPath, 'meta.json');
	var meta = require(metaPath);
	var group = bookmarks[meta.name] = {};
	group.contents = {};
	fs.readdir(notebookPath, function(err, list) {
		async.eachSeries(list, function(qvnote, innerCb) {
			if(hasExt(qvnote, EXT_NOTE))
				processNote(path.join(notebookPath, qvnote), group.contents, innerCb);
			else
				innerCb();
		}, function(err) {
			if(!err && isPruning() && !Object.keys(group.contents).length)
				delete bookmarks[meta.name];
			cb(err);
		});
	});
}

// Just in case: Fix https cert errors for UNABLE_TO_VERIFY_LEAF_SIGNATURE
// http://stackoverflow.com/questions/9440166/node-js-https-400-error-unable-to-verify-leaf-signature
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

function getTitleFromUrl(unresolved, cb) {
	var url = unresolved.url;
	var request;
	// Write the status line
	var status = '\rResolving ' + (unresolved.index + 1) + ' of ' + unresolvedLength + ': ' + url;
	process.stdout.write(status);
	function combineBuffers(response) {
		var buffers = [];
		if(response.statusCode !== 200) {
			console.error('\nNon-200 status code returned for ' + url + ': ' + response.statusCode);
			cb();
			return;
		}
		response.on('data', function (chunk) {
			buffers.push(chunk);
		});
		response.on('end', function() {
			var i;
			var size = 0;
			for(i = 0; i < buffers.length; ++i)
				size += buffers[i].length;
			var buffer = new Buffer(size);
			var end = 0;
			for(i = 0; i < buffers.length; ++i) {
				buffers[i].copy(buffer, end);
				end += buffers[i].length;
			}
			// Grab the title from the buffer
			var html = buffer.toString();
			var match = html.match(/<title.*?>(.*?)<\/title>/im);
			if(match) {
				unresolved.title = match[1];
				unresolved.note[unresolved.title] = url;
				delete unresolved.note[url];
			}
			// Clear the status line
			process.stdout.write('\r' + Array(status.length).join(' '));
			cb();
		});
		response.on('error', function(err) { console.log(''); console.error(err); cb(); });
	}

	if(url.substring(0,5) === 'https')
		request = https.get(url, combineBuffers);
	else
		request = http.get(url, combineBuffers);
	request.on('error', function(err) { console.log(''); console.error(err); cb(); });
}

function resolveTitles() {
	// titlesCache is a simple map of url: title
	// unresolved is an array of {note, url}
	var titlesCache = fs.existsSync(titleCachePath) ? require(titleCachePath) : {};
	var unresolvedArray = [];
	for(var notebookName in bookmarks) {
		if(bookmarks.hasOwnProperty(notebookName)) {
			var notebook = bookmarks[notebookName].contents;
			for(var noteName in notebook) {
				if(notebook.hasOwnProperty(noteName)) {
					var note = notebook[noteName].contents;
					for(var title in note) {
						if(note.hasOwnProperty(title)) {
							var url = note[title];
							if(title == url && !titlesCache[url] && !hasExt(url, '.pdf') && !hasExt(url, '.txt')) {
								unresolvedArray.push({note: note, url: url, index: unresolvedArray.length});
							}
							else if(titlesCache[url]) {
								note[titlesCache[url]] = url;
								delete note[title];
							}
						}
					}
				}
			}
		}
	}
	// Process all the unresolved urls
	unresolvedLength = unresolvedArray.length;
	async.eachSeries(unresolvedArray, getTitleFromUrl, function(err) {
		console.log('\nDone.');
		for(var i = 0; i < unresolvedArray.length; ++i) {
			titlesCache[unresolvedArray[i].url] = unresolvedArray[i].title;
		}
		fs.writeFile(titleCachePath, JSON.stringify(titlesCache), function(err) {
			outputBookmarks(err);
		});
	});
}

function outputBookmarks(err) {
	if(err)
		console.error(err);
	else
		fs.writeFile(getOutput(), netscape(bookmarks), function(err) { if(err) console.error(err); });
}

function printHelp() {
	function pad(str) { return str + Array(20 - str.length).join(' '); }
	var pkg = require('./package.json');
	console.log(pkg.name + ' - ' + pkg.version);
	console.log(pkg.description + '\n');
	console.log(pad(ARG_OUTPUT + ', ' + ARG_OUTPUT_SHORT) + 'Required - The output file to write.');
	console.log(pad(ARG_PRUNE + ', ' + ARG_PRUNE_SHORT) + 'Remove empty notebooks and notes from the output.');
	console.log(pad(ARG_RESOLVE + ', ' + ARG_RESOLVE_SHORT) + 'Resolve each bookmark title by scraping the URL and finding the <title> tag.');
	console.log(pad('') + 'The resolve cache file is/will be stored at: ' + titleCachePath);
	console.log(pad(ARG_HELP + ', ' + ARG_HELP_SHORT) + 'Print this help message.');
}

if(process.argv.indexOf(ARG_HELP) !== -1 || process.argv.indexOf(ARG_HELP_SHORT) !== -1) {
	printHelp();
	return 0;
}

if(!getOutput()) {
	console.error('Error: No output specified.\n');
	printHelp();
	return 1;
}

fs.readdir(libraryPath, function(err, list) {
	if(err) {
		console.error(err);
		return;
	}
	async.eachSeries(list, function(qvnotebook, cb) {
		if(hasExt(qvnotebook, EXT_NOTEBOOK))
			processNotebook(path.join(libraryPath, qvnotebook), cb);
		else
			cb();
	}, function(err) {
		if(err) {
			console.error(err);
		}
		else {
			if(isResolving())
				resolveTitles();
			else
				outputBookmarks();
		}
	});
});
