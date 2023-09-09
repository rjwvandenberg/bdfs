BDFS is game file unpacker for Black Desert (bdo). Last updated around mid year 2020.
(Will not decode without entry of decode key in 'src/wasm.ts', and WASM compilation of the [ICE encryption library](https://darkside.com.au/ice/index.html) and blackdesert_unpack code by Ekey & Luigi Auriemma)

## Features
- Full extraction of gamefiles
- Differential extraction between versions of Black Desert
- Complete file and folder structure of current version by linking to latest files in older differential extracts to minimize disk use.

## Setup
Enter the decode key and compile the ICE encryption library using something like EMScripten. Place it on the path specified in 'src/wasm.ts'. Then compile/run the typescript. 

## Usage (bootstrapping)
Assume you are extracting version 999.
``` 
<bdo> is your Black Desert Installation directory
<base> is the directory used for extracting the gamefiles
<padpath> should .meta file in the bdo directory, <bdo>/paz/pad00000.meta
<pazpath> refers to the bdo directory that contains files ending in .paz, <bdo>/paz
```
To extract all files enter the following command:
```
node index.js extract <bdo>/paz/pad00000.meta  <bdo>/paz/ <base>/999/
```
Next, to create the metadata file to check changes in gamefiles between versions:
```
node index.js createsha1map <padpath> <pazfolderpath> <base>/999/999.sha1
```
Finally, to create a datafolder that keeps up to date after extracting newer versions:
```
node index.js createcurrent <base> 999
```
You can now browse all bdo assets under .../base/current.
## Usage (update)

When the game updates (say version 1000), create a folder with the name 1000. Copy the update.log, into the new folder with the name 1000.update.log. The update log is found in the bdo directory after an update. Then run:

```
node index.js update <bdo> <base>/999 <base>/1000
```
This will copy the files that changed between 999 and 1000. And record any file that was added, deleted or updated in base/1000/changelog.

To apply changes to base/current folder run:
```
node index.js updatecurrent <base> 1000
```
This will remove hardlinks of files deleted in 1000, update hardlinks from 999 to 1000 if the file was changed and add new hardlinks for files added in 1000. 

Finally you can run:
```
node index.js checkcurrent <base>
```
Which is a sanity check to validate all version 1000 files are present and have the correct size.

## Resources
In researching the fileformats the most useful information was found on Xentax Forums, Ragezone forums and [QuickBMS (by Luigi Auriemma)](http://aluigi.altervista.org/quickbms.htm). I'm sure there were more sources, but they're impossible to recall three years after writing this program.
