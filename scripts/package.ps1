param(
    [Parameter(Mandatory=$true)][string]$TizenCli,
    [Parameter(Mandatory=$true)][string]$CertificateProfile,
    [string]$Observer
)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
if(-not (Test-Path -LiteralPath (Join-Path $root 'app/decipher-worker.js'))){throw 'Build the decipher worker before packaging.'}
[xml]$manifest=[IO.File]::ReadAllText((Join-Path $root 'app/config.xml'))
$version=$manifest.widget.version
$destination=Join-Path $root ('artifacts/'+$version)
if(Test-Path -LiteralPath $destination){throw 'Preserve existing builds: increment the version before packaging.'}
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$stage=Join-Path $destination 'app'
New-Item -ItemType Directory -Path $stage | Out-Null
$appRoot=Join-Path $root 'app'
Get-ChildItem -LiteralPath $appRoot -File -Recurse | Where-Object { $_.Name -notlike '*.local.*' -and $_.Name -notlike '*signature*.xml' -and $_.Name -notlike '.*' } | ForEach-Object {
    $relative=$_.FullName.Substring($appRoot.Length).TrimStart([char[]]'\/')
    $target=Join-Path $stage $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    Copy-Item -LiteralPath $_.FullName -Destination $target
}
Copy-Item -Path (Join-Path $root 'native/assets/*.txt') -Destination $stage
Copy-Item -LiteralPath (Join-Path $root 'LICENSE') -Destination $stage
Copy-Item -LiteralPath (Join-Path $root 'README.md') -Destination $stage
if($Observer){
    $html=[IO.File]::ReadAllText((Join-Path $stage 'index.html'))
    $dev='<script>window.observeEndpoint='+($Observer.TrimEnd('/')|ConvertTo-Json -Compress)+';</script><script src="dev-client.js"></script>'
    $html=$html.Replace('<script src="app.js"></script>',$dev+'<script src="app.js"></script>')
    [IO.File]::WriteAllText((Join-Path $stage 'index.html'),$html)
    Copy-Item -LiteralPath (Join-Path $root 'scripts/dev-client.js') -Destination $stage
}
if(-not $Observer){
    $htmlPath=Join-Path $stage 'index.html'
    $html=[IO.File]::ReadAllText($htmlPath)
    foreach($experimental in @('hls.js','hls-proxy.js','promise-polyfill.js')){
        $html=$html.Replace(('<script src="'+$experimental+'"></script>'),'')
        Remove-Item -LiteralPath (Join-Path $stage $experimental)
    }
    [IO.File]::WriteAllText($htmlPath,$html)
    # Keep the distributable independent of a particular TV's certificate.
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $unsignedWgt=Join-Path $destination 'TizenTube-2.4-Native.wgt'
    $releaseZip=Join-Path $destination ('TizenTube-2.4-Native-'+$version+'.zip')
    try{
        $wgtArchive=[IO.Compression.ZipFile]::Open($unsignedWgt,[IO.Compression.ZipArchiveMode]::Create)
        try{
            Get-ChildItem -LiteralPath $stage -File -Recurse | Sort-Object FullName | ForEach-Object {
                $entryName=$_.FullName.Substring($stage.Length).TrimStart([char[]]'\/').Replace('\','/')
                [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($wgtArchive,$_.FullName,$entryName,[IO.Compression.CompressionLevel]::Optimal) | Out-Null
            }
        } finally { $wgtArchive.Dispose() }
        $zipArchive=[IO.Compression.ZipFile]::Open($releaseZip,[IO.Compression.ZipArchiveMode]::Create)
        try{
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zipArchive,$unsignedWgt,'TizenTube-2.4-Native.wgt',[IO.Compression.CompressionLevel]::Optimal) | Out-Null
        } finally { $zipArchive.Dispose() }
    } finally {
        if(Test-Path -LiteralPath $unsignedWgt){ Remove-Item -LiteralPath $unsignedWgt }
    }
}
& $TizenCli package -t wgt -s $CertificateProfile -o $destination -- $stage
if($LASTEXITCODE){throw 'Packaging failed'}
$built=@(Get-ChildItem -LiteralPath $destination -Filter '*.wgt' -File)
if($built.Count-ne 1){throw 'Expected one package'}
Move-Item -LiteralPath $built[0].FullName -Destination (Join-Path $destination ('TizenTube-2.4-Native-'+$version+'.wgt'))
