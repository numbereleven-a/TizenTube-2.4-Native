param(
    [Parameter(Mandatory = $true)][string]$SdkRoot,
    [Parameter(Mandatory = $true)][string]$MbedTlsRoot,
    [Parameter(Mandatory = $true)][string]$ZlibRoot,
    [switch]$SkipLibraries
)
$ErrorActionPreference = 'Stop'
$projectRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'native'
$SdkRoot = (Resolve-Path -LiteralPath $SdkRoot).Path
$MbedTlsRoot = (Resolve-Path -LiteralPath $MbedTlsRoot).Path
$ZlibRoot = (Resolve-Path -LiteralPath $ZlibRoot).Path
$buildRoot = Join-Path $projectRoot 'build'
$compilerRoot = Join-Path $SdkRoot 'toolchain/win_arm_newlib/bin'
$cc = Join-Path $compilerRoot 'arm-nacl-gcc.exe'
$cxx = Join-Path $compilerRoot 'arm-nacl-g++.exe'
$ar = Join-Path $compilerRoot 'arm-nacl-ar.exe'
New-Item -ItemType Directory -Path $buildRoot -Force | Out-Null
function Invoke-Compiler([string]$Program, [string[]]$CompilerArguments) {
    & $Program @CompilerArguments
    if ($LASTEXITCODE -ne 0) { throw ('Compilation failed: ' + [IO.Path]::GetFileName($Program)) }
}
$common = @('-O2', '-g0', '-DNDEBUG', '-ffunction-sections', '-fdata-sections')
$mbedFlags = $common + @('-std=c99', '-Iinclude', '-Ilibrary', ('-I' + (Join-Path $projectRoot 'src')), '-DMBEDTLS_USER_CONFIG_FILE=<mbedtls_user_config.h>')
$ppapiFlags = $common + @('-std=gnu++11', '-Iinclude', '-pthread')
if (-not $SkipLibraries) {
    $objects = @()
    Push-Location $MbedTlsRoot
    try {
        foreach ($file in Get-ChildItem -LiteralPath 'library' -Filter '*.c' -File) {
            $object = Join-Path $buildRoot ('mbed-' + $file.BaseName + '.o')
            Invoke-Compiler $cc ($mbedFlags + @('-c', ('library/' + $file.Name), '-o', $object))
            $objects += $object
        }
        Invoke-Compiler $ar (@('rcs', (Join-Path $buildRoot 'libmbedtls.a')) + $objects)
        Write-Output 'Built Mbed TLS library'
    } finally { Pop-Location }
    $objects = @()
    Push-Location $SdkRoot
    try {
        foreach ($file in Get-ChildItem -LiteralPath 'src/ppapi_cpp' -Filter '*.cc' -File) {
            $object = Join-Path $buildRoot ('ppapi-' + $file.BaseName + '.o')
            Invoke-Compiler $cxx ($ppapiFlags + @('-c', ('src/ppapi_cpp/' + $file.Name), '-o', $object))
            $objects += $object
        }
        Invoke-Compiler $ar (@('rcs', (Join-Path $buildRoot 'libppapi_cpp.a')) + $objects)
        Write-Output 'Built PPAPI library'
    } finally { Pop-Location }
}
if (-not $SkipLibraries -or -not (Test-Path -LiteralPath (Join-Path $buildRoot 'libz.a'))) {
    $objects = @()
    Push-Location $ZlibRoot
    try {
        foreach ($name in @('adler32','crc32','inflate','inffast','inftrees','zutil')) {
            $object = Join-Path $buildRoot ('zlib-' + $name + '.o')
            Invoke-Compiler $cc ($common + @('-std=c99', '-I.', '-c', ($name + '.c'), '-o', $object))
            $objects += $object
        }
        Invoke-Compiler $ar (@('rcs', (Join-Path $buildRoot 'libz.a')) + $objects)
        Write-Output 'Built zlib inflater'
    } finally { Pop-Location }
}
$pem = [IO.File]::ReadAllText((Join-Path $projectRoot 'assets/ca-roots.pem')).Replace("`r", '')
$literals = ($pem -split "`n" | ForEach-Object { '"' + $_.Replace('\', '\\').Replace('"', '\"') + '\n"' }) -join "`n"
[IO.File]::WriteAllText((Join-Path $buildRoot 'ca_roots.h'), "static const unsigned char ca_roots[] =`n" + $literals + ";`n")
