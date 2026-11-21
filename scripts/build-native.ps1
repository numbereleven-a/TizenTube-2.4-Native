param(
    [Parameter(Mandatory=$true)][string]$SdkRoot,
    [Parameter(Mandatory=$true)][string]$MbedTlsRoot,
    [Parameter(Mandatory=$true)][string]$ZlibRoot,
    [switch]$TestHttpFailures
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$SdkRoot = (Resolve-Path -LiteralPath $SdkRoot).Path
$MbedTlsRoot = (Resolve-Path -LiteralPath $MbedTlsRoot).Path
$ZlibRoot = (Resolve-Path -LiteralPath $ZlibRoot).Path
if (-not (Test-Path -LiteralPath (Join-Path $root 'native/build/libmbedtls.a')) -or
    -not (Test-Path -LiteralPath (Join-Path $root 'native/build/libppapi_cpp.a')) -or
    -not (Test-Path -LiteralPath (Join-Path $root 'native/build/libz.a'))) {
    & (Join-Path $PSScriptRoot 'build-libraries.ps1') -SdkRoot $SdkRoot -MbedTlsRoot $MbedTlsRoot -ZlibRoot $ZlibRoot
}
$compiler = Join-Path $SdkRoot 'toolchain/win_arm_newlib/bin/arm-nacl-g++.exe'
Push-Location $root
try {
    $flags = @('-std=gnu++14','-O2','-g0','-DNDEBUG','-Wall','-pthread','-ffunction-sections','-fdata-sections',
        ('-I'+(Join-Path $SdkRoot 'include')),('-I'+(Join-Path $MbedTlsRoot 'include')),('-I'+$ZlibRoot),
        '-Inative/src','-Inative/build','-DMBEDTLS_USER_CONFIG_FILE=<mbedtls_user_config.h>')
    if($TestHttpFailures){$flags += '-DTTL_TEST_HTTP_FAILURES'}
    $objects = @()
    foreach ($source in @('transport.cc','player.cc','media/demuxer.cpp','media/mp4.cpp','media/webm.cpp')) {
        $object = 'native/build/' + [IO.Path]::GetFileNameWithoutExtension($source) + '.o'
        $standard = if ($source.EndsWith('.cc')) { '-std=gnu++11' } else { '-std=gnu++14' }
        & $compiler @flags $standard -c ('native/src/' + $source) -o $object
        if ($LASTEXITCODE) { throw ('Native compilation failed: ' + $source) }
        $objects += $object
    }
    & $compiler -pthread '-Wl,--gc-sections' -s -o app/player.nexe @objects -Lnative/build -lmbedtls -lz -lppapi_cpp -lppapi
    if ($LASTEXITCODE) { throw 'Native linking failed' }
    [IO.File]::WriteAllText((Join-Path $root 'app/player.nmf'), '{"program":{"arm":{"url":"player.nexe"}}}')
} finally { Pop-Location }
