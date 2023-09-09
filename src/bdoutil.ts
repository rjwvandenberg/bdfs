// probably euc-kr or iso-2022-kr
// https://www.npmjs.com/package/iconv
const Iconv = require('iconv').Iconv

const KRtoUTF8 = new Iconv('EUC-KR', 'UTF-8')

// function isASCII(str: string) : boolean {
//     return /^[\x20-\x7F]*$/.test(str) 
// }

function readString(data: Buffer) : string {
    const str = KRtoUTF8.convert(data).toString('utf8')
    // if (!isASCII(str)){
    //     console.log(str)
    // }
    return str
}

export async function readPadStrings(data: Buffer, isfolder: boolean) : Promise<string[]> {
    const strings = []
    const STRINGHEADERSIZE = isfolder ? 8 : 0
    let offset = STRINGHEADERSIZE
    let endoffset = STRINGHEADERSIZE
    while (offset < data.length && endoffset < data.length) {
        endoffset=data.indexOf(0,offset)
        if(endoffset == -1) {
            break
        } 
        strings.push(readString(data.slice(offset,endoffset)))
        offset = endoffset + 1 + STRINGHEADERSIZE
    }
    return strings
}