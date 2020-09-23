const path = require('path');
const {exec} = require('child_process');
const {lstatSync, readdirSync, readFileSync, writeFileSync} = require('fs');

const {series, parallel, src, dest} = require('gulp');
const gulpif = require('gulp-if');
const jsonMerge = require('gulp-merge-json');
const jsonmin = require('gulp-jsonmin');
const imagemin = require('gulp-imagemin');
const del = require('del');
const {ensureDirSync} = require('fs-extra');
const sharp = require('sharp');

const targetEnv = process.env.TARGET_ENV || 'firefox';
const isProduction = process.env.NODE_ENV === 'production';
const distDir = path.join('dist', targetEnv);

function clean() {
  return del([distDir]);
}

async function images(done) {
  ensureDirSync(path.join(distDir, 'src/icons/app'));
  const appIconSvg = readFileSync('src/icons/app/icon.svg');
  const appIconSizes = [16, 19, 24, 32, 38, 48, 64, 96, 128];
  for (const size of appIconSizes) {
    await sharp(appIconSvg, {density: (72 * size) / 24})
      .resize(size)
      .toFile(path.join(distDir, `src/icons/app/icon-${size}.png`));
  }
  // Chrome Web Store does not correctly display optimized icons
  if (isProduction && targetEnv !== 'chrome') {
    await new Promise(resolve => {
      src(path.join(distDir, 'src/icons/app/*.png'), {base: '.'})
        .pipe(imagemin())
        .pipe(dest('.'))
        .on('error', done)
        .on('finish', resolve);
    });
  }
}

async function locale(done) {
  const localesRootDir = path.join(__dirname, 'src/_locales');
  const localeDirs = readdirSync(localesRootDir).filter(function (file) {
    return lstatSync(path.join(localesRootDir, file)).isDirectory();
  });
  for (const localeDir of localeDirs) {
    const localePath = path.join(localesRootDir, localeDir);
    await new Promise(resolve => {
      src(
        [
          path.join(localePath, 'messages.json'),
          path.join(localePath, `messages-${targetEnv}.json`)
        ],
        {allowEmpty: true}
      )
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
        .pipe(dest(path.join(distDir, '_locales', localeDir)))
        .on('error', done)
        .on('finish', resolve);
    });
  }
}

function manifest() {
  return src('src/manifest.json')
    .pipe(
      jsonMerge({
        fileName: 'manifest.json',
        edit: (parsedJson, file) => {
          if (['chrome'].includes(targetEnv)) {
            delete parsedJson.browser_specific_settings;
          }

          if (['firefox'].includes(targetEnv)) {
            delete parsedJson.minimum_chrome_version;
          }

          parsedJson.chrome_settings_overrides.search_provider.suggest_url = parsedJson.chrome_settings_overrides.search_provider.suggest_url.replace(
            '{client}',
            targetEnv
          );

          parsedJson.version = require('./package.json').version;
          return parsedJson;
        }
      })
    )
    .pipe(gulpif(isProduction, jsonmin()))
    .pipe(dest(distDir));
}

function license() {
  let year = '2017';
  const currentYear = new Date().getFullYear().toString();
  if (year !== currentYear) {
    year = `${year}-${currentYear}`;
  }

  const notice = `Search on Google US
Copyright (c) ${year} Armin Sebastian

This software is released under the terms of the GNU General Public License v3.0.
See the LICENSE file for further information.
`;

  writeFileSync(path.join(distDir, 'NOTICE'), notice);
  return src(['LICENSE']).pipe(dest(distDir));
}

function zip(done) {
  exec(
    `web-ext build -s dist/${targetEnv} -a artifacts/${targetEnv} -n '{name}-{version}-${targetEnv}.zip' --overwrite-dest`,
    function (err, stdout, stderr) {
      console.log(stdout);
      console.log(stderr);
      done(err);
    }
  );
}

exports.build = series(clean, parallel(images, locale, manifest, license));
exports.zip = zip;
