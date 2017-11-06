const path = require('path');
const {lstatSync, readdirSync, readFileSync, writeFileSync} = require('fs');
const {ensureDirSync} = require('fs-extra');
const recursiveReadDir = require('recursive-readdir');
const gulp = require('gulp');
const gulpSeq = require('gulp-sequence');
const gulpif = require('gulp-if');
const del = require('del');
const jsonMerge = require('gulp-merge-json');
const jsonmin = require('gulp-jsonmin');
const svg2png = require('svg2png');
const imagemin = require('gulp-imagemin');

const targetEnv = process.env.TARGET_ENV || 'firefox';
const isProduction = process.env.NODE_ENV === 'production';

gulp.task('clean', function() {
  return del(['dist']);
});

gulp.task('icons', async function() {
  ensureDirSync('dist/src/icons/app');
  const svgPaths = await recursiveReadDir('src/icons', ['*.!(svg)']);
  for (svgPath of svgPaths) {
    const pngBuffer = await svg2png(readFileSync(svgPath));
    writeFileSync(
      path.join('dist', svgPath.replace(/^(.*)\.svg$/i, '$1.png')),
      pngBuffer
    );
  }

  if (isProduction) {
    gulp
      .src('dist/src/icons/**/*.png', {base: '.'})
      .pipe(imagemin())
      .pipe(gulp.dest(''));
  }
});

gulp.task('locale', function() {
  const localesRootDir = path.join(__dirname, 'src/_locales');
  const localeDirs = readdirSync(localesRootDir).filter(function(file) {
    return lstatSync(path.join(localesRootDir, file)).isDirectory();
  });
  localeDirs.forEach(function(localeDir) {
    const localePath = path.join(localesRootDir, localeDir);
    gulp
      .src([
        path.join(localePath, 'messages.json'),
        path.join(localePath, `messages-${targetEnv}.json`)
      ])
      .pipe(
        jsonMerge({
          fileName: 'messages.json',
          edit: (parsedJson, file) => {
            if (isProduction) {
              for (let [key, value] of Object.entries(parsedJson)) {
                if (value.hasOwnProperty('description')) {
                  delete parsedJson[key].description;
                }
              }
            }
            return parsedJson;
          }
        })
      )
      .pipe(gulpif(isProduction, jsonmin()))
      .pipe(gulp.dest(path.join('dist/_locales', localeDir)));
  });
});

gulp.task('manifest', function() {
  return gulp
    .src('src/manifest.json')
    .pipe(
      jsonMerge({
        fileName: 'manifest.json',
        edit: (parsedJson, file) => {
          if (['chrome'].includes(targetEnv)) {
            delete parsedJson.applications;
          }

          if (['firefox'].includes(targetEnv)) {
            delete parsedJson.minimum_chrome_version;
          }

          parsedJson.version = require('./package.json').version;
          return parsedJson;
        }
      })
    )
    .pipe(gulpif(isProduction, jsonmin()))
    .pipe(gulp.dest('dist'));
});

gulp.task('copy', function() {
  gulp.src(['LICENSE']).pipe(gulp.dest('dist'));
});

gulp.task('build', gulpSeq('clean', ['icons', 'locale', 'manifest', 'copy']));

gulp.task('default', ['build']);
