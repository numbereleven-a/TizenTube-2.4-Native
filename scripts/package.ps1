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
    $files=@(Get-ChildItem -LiteralPath $stage)
    Compress-Archive -LiteralPath $files.FullName -DestinationPath (Join-Path $destination ('TizenTube-2.4-Native-'+$version+'.zip'))
}
& $TizenCli package -t wgt -s $CertificateProfile -o $destination -- $stage
if($LASTEXITCODE){throw 'Packaging failed'}
$built=@(Get-ChildItem -LiteralPath $destination -Filter '*.wgt' -File)
if($built.Count-ne 1){throw 'Expected one package'}
Move-Item -LiteralPath $built[0].FullName -Destination (Join-Path $destination ('TizenTube-2.4-Native-'+$version+'.wgt'))
